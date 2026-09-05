// src/lib/ops/growth/load.ts
//
// The only IO in the growth feature. Everything else is pure.
// Both the dashboard page and the daily cron call this, so a number in the
// email and the same number on the page cannot drift apart.
import { clerkClient } from "@clerk/nextjs/server";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, clients, firms, subscriptionItems, subscriptions } from "@/db/schema";
import { isMissingOrganizationError } from "./clerk-errors";
import { PAID_STATUSES, type ClerkUserInput, type GrowthInput } from "./types";

/** Audit rows older than this are never needed by any builder. */
const ACTIVITY_WINDOW_DAYS = 30;
const CLERK_PAGE = 100;

/**
 * The statuses in which a firm's subscription is live. This equals the WHERE
 * list of the partial unique index `subscriptions_firm_active_unique`, which
 * guarantees at most one such row per firm.
 */
const LIVE_STATUSES = ["trialing", ...PAID_STATUSES];

/**
 * Walk every Clerk account. `limit`/`offset` are optional in the SDK's
 * pagination type and the server's default page size is not "all", so this
 * pages explicitly against `totalCount` rather than trusting one call.
 */
async function listAllClerkUsers() {
  const cc = await clerkClient();
  const out: Awaited<ReturnType<typeof cc.users.getUserList>>["data"] = [];
  for (let offset = 0; ; offset += CLERK_PAGE) {
    const { data, totalCount } = await cc.users.getUserList({
      limit: CLERK_PAGE,
      offset,
    });
    out.push(...data);
    if (data.length === 0 || out.length >= totalCount) break;
  }
  return out;
}

/**
 * Every Clerk user id in one organization's membership list, paged.
 * Split out of `membershipsByUser` so that function's try/catch wraps one
 * call rather than sitting inside this inner paging loop — a `continue` in
 * a catch nested in the loop below would restart the CURRENT page forever
 * instead of moving on to the next firm.
 */
async function memberUserIdsForOrg(
  cc: Awaited<ReturnType<typeof clerkClient>>,
  organizationId: string,
): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += CLERK_PAGE) {
    const { data, totalCount } = await cc.organizations.getOrganizationMembershipList({
      organizationId,
      limit: CLERK_PAGE,
      offset,
    });
    for (const m of data) {
      const uid = m.publicUserData?.userId;
      if (uid) out.push(uid);
    }
    if (data.length === 0 || offset + data.length >= totalCount) break;
  }
  return out;
}

/**
 * userId → every firm id they are a member of.
 *
 * Dev/prod `firms` rows can point at a Clerk organization that no longer
 * exists (deleted org, or a DB-only test fixture) — Clerk 404s on that id.
 * That is a data shape, not an incident: skip the firm and keep walking.
 * Every other error (auth, rate limit, a differently-shaped 404) still
 * propagates and fails the page loudly, as before.
 */
async function membershipsByUser(firmIds: string[]): Promise<Map<string, string[]>> {
  const cc = await clerkClient();
  const map = new Map<string, string[]>();
  for (const organizationId of firmIds) {
    let userIds: string[];
    try {
      userIds = await memberUserIdsForOrg(cc, organizationId);
    } catch (err) {
      if (isMissingOrganizationError(err)) continue;
      throw err;
    }
    for (const uid of userIds) {
      map.set(uid, [...(map.get(uid) ?? []), organizationId]);
    }
  }
  return map;
}

export async function loadGrowthInput(now: Date = new Date()): Promise<GrowthInput> {
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86_400_000);

  const [firmRows, subRows, itemRows, activityRows, clientCounts] = await Promise.all([
    db.select().from(firms),
    // One row per firm. The partial unique index guarantees at most one LIVE
    // row per firm, but canceled/incomplete rows accumulate beside it and a
    // plain select would hand the builders an arbitrary one. Prefer the live
    // row; failing that, the newest.
    db
      .selectDistinctOn([subscriptions.firmId])
      .from(subscriptions)
      .orderBy(
        subscriptions.firmId,
        desc(inArray(subscriptions.status, LIVE_STATUSES)),
        desc(subscriptions.createdAt),
      ),
    db.select().from(subscriptionItems).where(isNull(subscriptionItems.removedAt)),
    // actor_kind is the discriminator, but 51 advisor-stamped rows on prod
    // carry a non-`user_` actor id, so the id shape is required as well —
    // counting a webhook as an active user is exactly the flattering error
    // this page exists to avoid.
    db
      .select({
        firmId: auditLog.firmId,
        actorId: auditLog.actorId,
        action: auditLog.action,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          gte(auditLog.createdAt, since),
          eq(auditLog.actorKind, "advisor"),
          sql`${auditLog.actorId} LIKE 'user_%'`,
        ),
      ),
    db
      .select({ firmId: clients.firmId, n: sql<number>`count(*)::int` })
      .from(clients)
      .groupBy(clients.firmId),
  ]);

  const firmIds = firmRows.map((f) => f.firmId);
  const [clerkUsers, memberships] = await Promise.all([
    listAllClerkUsers(),
    membershipsByUser(firmIds),
  ]);

  const users: ClerkUserInput[] = clerkUsers.map((u) => {
    const stash = (u.privateMetadata as Record<string, unknown> | undefined)?.pending_signup as
      | { firmName?: unknown }
      | null
      | undefined;
    const firmName = typeof stash?.firmName === "string" ? stash.firmName.trim() : "";
    return {
      userId: u.id,
      email: u.emailAddresses[0]?.emailAddress ?? null,
      firstName: u.firstName,
      lastName: u.lastName,
      createdAt: new Date(u.createdAt),
      lastSignInAt: u.lastSignInAt ? new Date(u.lastSignInAt) : null,
      // A stash with no firm name is a half-filled form, not a completed one:
      // `coerce()` in pending-signup.ts treats it as absent, so this must too.
      hasPendingSignup: firmName.length > 0,
      pendingFirmName: firmName || null,
      firmIds: memberships.get(u.id) ?? [],
    };
  });

  return {
    firms: firmRows.map((f) => ({
      firmId: f.firmId,
      displayName: f.displayName,
      isFounder: f.isFounder,
      archivedAt: f.archivedAt,
      createdAt: f.createdAt,
    })),
    subs: subRows.map((s) => ({
      firmId: s.firmId,
      status: s.status,
      trialStart: s.trialStart,
      trialEnd: s.trialEnd,
      canceledAt: s.canceledAt,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
    })),
    items: itemRows.map((i) => ({
      firmId: i.firmId,
      quantity: i.quantity,
      unitAmount: i.unitAmount,
      removedAt: i.removedAt,
    })),
    activity: activityRows,
    users,
    clientCountByFirm: Object.fromEntries(clientCounts.map((c) => [c.firmId, c.n])),
    now,
  };
}
