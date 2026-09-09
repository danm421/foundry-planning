import "server-only";
import { and, eq, gt, inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import { portalBindings, clients } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

/** How long an access request stays acceptable. */
export const REQUEST_TTL_DAYS = 14;

/** How long a declined firm must wait before asking that household again. */
export const DECLINE_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A null expiry means "no expiry" — invitation-path rows are not requests. */
export function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now();
}

export function cooldownEndsAt(declinedAt: Date): Date {
  return new Date(declinedAt.getTime() + DECLINE_COOLDOWN_DAYS * DAY_MS);
}

export type BindingRef = {
  bindingId: string;
  clientId: string;
  firmId: string | null;
  advisorId: string;
  acceptedAt: Date | null;
};

/**
 * Every household this login may currently open, newest acceptance first.
 *
 * Joins `clients` because every portal gate needs `firmId` and `advisorId` —
 * a portal user has no org of their own, so the household's firm and owning
 * advisor are what authorize them. One query, not two.
 */
export async function listActiveBindings(clerkUserId: string): Promise<BindingRef[]> {
  if (!clerkUserId) return [];
  return db
    .select({
      bindingId: portalBindings.id,
      clientId: portalBindings.clientId,
      firmId: clients.firmId,
      advisorId: clients.advisorId,
      acceptedAt: portalBindings.acceptedAt,
    })
    .from(portalBindings)
    .innerJoin(clients, eq(clients.id, portalBindings.clientId))
    .where(and(eq(portalBindings.clerkUserId, clerkUserId), eq(portalBindings.status, "active")))
    .orderBy(desc(portalBindings.acceptedAt));
}

export type PendingRequest = {
  bindingId: string;
  clientId: string;
  firmId: string | null;
  requestedBy: string | null;
  expiresAt: Date | null;
};

/** Un-expired pending requests awaiting this person's decision. */
export async function listPendingRequests(clerkUserId: string): Promise<PendingRequest[]> {
  if (!clerkUserId) return [];
  return db
    .select({
      bindingId: portalBindings.id,
      clientId: portalBindings.clientId,
      firmId: clients.firmId,
      requestedBy: portalBindings.requestedBy,
      expiresAt: portalBindings.expiresAt,
    })
    .from(portalBindings)
    .innerJoin(clients, eq(clients.id, portalBindings.clientId))
    .where(
      and(
        eq(portalBindings.clerkUserId, clerkUserId),
        eq(portalBindings.status, "pending"),
        gt(portalBindings.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(portalBindings.requestedAt));
}

/**
 * Write the `pending` row an advisor's access request creates.
 *
 * Refuses two ways, both by reading rather than by relying on the partial
 * unique index — the index protects the invariant, these produce the message.
 */
export async function createPendingBinding(args: {
  clientId: string;
  clerkUserId: string;
  requestedBy: string;
  ttlDays?: number;
}): Promise<{ ok: true; bindingId: string } | { ok: false; reason: "already_live" | "recently_declined" }> {
  const { clientId, clerkUserId, requestedBy } = args;
  const ttl = args.ttlDays ?? REQUEST_TTL_DAYS;

  const live = await db
    .select({ id: portalBindings.id })
    .from(portalBindings)
    .where(
      and(
        eq(portalBindings.clientId, clientId),
        eq(portalBindings.clerkUserId, clerkUserId),
        inArray(portalBindings.status, ["pending", "active"]),
      ),
    )
    .limit(1);
  if (live[0]) return { ok: false, reason: "already_live" };

  const declined = await db
    .select({ endedAt: portalBindings.endedAt })
    .from(portalBindings)
    .where(
      and(
        eq(portalBindings.clientId, clientId),
        eq(portalBindings.clerkUserId, clerkUserId),
        eq(portalBindings.status, "declined"),
      ),
    )
    .orderBy(desc(portalBindings.endedAt))
    .limit(1);
  const lastDecline = declined[0]?.endedAt;
  if (lastDecline && cooldownEndsAt(lastDecline).getTime() > Date.now()) {
    return { ok: false, reason: "recently_declined" };
  }

  const now = new Date();
  const [row] = await db
    .insert(portalBindings)
    .values({
      clientId,
      clerkUserId,
      status: "pending",
      requestedBy,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + ttl * DAY_MS),
    })
    .returning({ id: portalBindings.id });

  return { ok: true, bindingId: row.id };
}

/**
 * Promote a pending row to active. ONLY the owning login may call this — the
 * `clerkUserId` predicate is the authorization, not a filter.
 */
export async function acceptBinding(
  bindingId: string,
  clerkUserId: string,
): Promise<{ ok: true; clientId: string } | { ok: false; reason: "not_found" | "expired" | "not_pending" }> {
  const rows = await db
    .select({
      clientId: portalBindings.clientId,
      status: portalBindings.status,
      expiresAt: portalBindings.expiresAt,
      firmId: clients.firmId,
    })
    .from(portalBindings)
    .innerJoin(clients, eq(clients.id, portalBindings.clientId))
    .where(and(eq(portalBindings.id, bindingId), eq(portalBindings.clerkUserId, clerkUserId)))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "pending") return { ok: false, reason: "not_pending" };
  if (isExpired(row.expiresAt)) return { ok: false, reason: "expired" };

  await db
    .update(portalBindings)
    .set({ status: "active", acceptedAt: new Date() })
    .where(eq(portalBindings.id, bindingId));

  await recordAudit({
    action: "portal.access.accepted",
    resourceType: "portal_binding",
    resourceId: bindingId,
    clientId: row.clientId,
    firmId: row.firmId ?? "",
    actorId: clerkUserId,
    actorKind: "client",
    metadata: { clerkUserId },
  });

  return { ok: true, clientId: row.clientId };
}

/** Decline a pending request. Starts the re-request cooldown. */
export async function declineBinding(bindingId: string, clerkUserId: string): Promise<boolean> {
  const rows = await db
    .select({ clientId: portalBindings.clientId, status: portalBindings.status, firmId: clients.firmId })
    .from(portalBindings)
    .innerJoin(clients, eq(clients.id, portalBindings.clientId))
    .where(and(eq(portalBindings.id, bindingId), eq(portalBindings.clerkUserId, clerkUserId)))
    .limit(1);

  const row = rows[0];
  if (!row || row.status !== "pending") return false;

  await db
    .update(portalBindings)
    .set({ status: "declined", endedAt: new Date(), endedBy: "client" })
    .where(eq(portalBindings.id, bindingId));

  await recordAudit({
    action: "portal.access.declined",
    resourceType: "portal_binding",
    resourceId: bindingId,
    clientId: row.clientId,
    firmId: row.firmId ?? "",
    actorId: clerkUserId,
    actorKind: "client",
    metadata: { clerkUserId },
  });

  return true;
}

/**
 * End an active binding. Writes ONE row and nothing else — the household, its
 * plan, its documents and its audit history are untouched by design.
 */
export async function revokeBinding(args: {
  clientId: string;
  clerkUserId: string;
  endedBy: "client" | "advisor";
  actorId: string;
}): Promise<boolean> {
  const { clientId, clerkUserId, endedBy, actorId } = args;

  const rows = await db
    .select({ id: portalBindings.id, firmId: clients.firmId })
    .from(portalBindings)
    .innerJoin(clients, eq(clients.id, portalBindings.clientId))
    .where(
      and(
        eq(portalBindings.clientId, clientId),
        eq(portalBindings.clerkUserId, clerkUserId),
        eq(portalBindings.status, "active"),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return false;

  await db
    .update(portalBindings)
    .set({ status: "revoked", endedAt: new Date(), endedBy })
    .where(eq(portalBindings.id, row.id));

  await recordAudit({
    action: endedBy === "client" ? "portal.access.revoked_by_client" : "portal.access.revoked_by_advisor",
    resourceType: "portal_binding",
    resourceId: row.id,
    clientId,
    firmId: row.firmId ?? "",
    actorId,
    actorKind: endedBy === "client" ? "client" : "advisor",
    metadata: { clerkUserId, endedBy },
  });

  return true;
}

/**
 * The `clerk_user_id` of the active binding for this household, or null.
 *
 * A bridge for legacy call sites that only understand one login per
 * household (the shape `clients.clerk_user_id` used to have): the disable
 * route, Manage Portal, the portal account route, and the intake
 * data-collection route all currently answer "is this household bound?" by
 * reading that column alone. A client who *accepts an access request* writes
 * only a `portal_bindings` row and never touches that column, so without this
 * function such a client is invisible to their own advisor on those surfaces.
 *
 * A household can deliberately hold more than one active binding — two
 * spouses, each with their own login — and that is by design, not a gap.
 * This returns the most recently accepted one because every advisor-side
 * surface this feeds is single-login by design *today* (the Manage Portal
 * card, the portal account support actions, the disable route), and this
 * plan does not redesign them. That makes "most recently accepted" the
 * correct answer for this deploy, not a stopgap — but it is an assumption a
 * future multi-login household view needs to know it's inheriting.
 */
export async function getActiveBindingClerkUserId(clientId: string): Promise<string | null> {
  if (!clientId) return null;
  const rows = await db
    .select({ clerkUserId: portalBindings.clerkUserId })
    .from(portalBindings)
    .where(and(eq(portalBindings.clientId, clientId), eq(portalBindings.status, "active")))
    .orderBy(desc(portalBindings.acceptedAt))
    .limit(1);
  return rows[0]?.clerkUserId ?? null;
}
