import "server-only";
import { and, eq, gt, or, isNull, isNotNull, inArray, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { portalBindings, clients, type PortalBindingStatus } from "@/db/schema";
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
  firmId: string;
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
    // Postgres sorts DESC with NULLs FIRST by default, which would put an
    // active row with no recorded acceptedAt ahead of a genuinely recent one.
    // Clean today (migration 0263 backfilled every existing row), but a later
    // task's invitation path can write `active` without acceptedAt — force
    // NULLS LAST so an unknown accept time reads as oldest, not newest.
    .orderBy(sql`${portalBindings.acceptedAt} DESC NULLS LAST`);
}

/** A binding row in ANY status. `listBindingsForUser` is the only producer. */
export type BindingRow = BindingRef & { status: PortalBindingStatus };

/**
 * EVERY binding row this login holds, in ANY status, newest acceptance first.
 *
 * Deliberately NOT filtered to `active`: the dual-read chokepoint needs the
 * STATUSES, not just a count. `getPortalClientRef` falls back to the pre-0263
 * `clients.clerk_user_id` column, and only for a login this table has never
 * settled anything for — no `active` row and no `revoked` one. A REVOKED row
 * has to be visible here, because falling back on one would read a legacy
 * column that revoking deliberately does not clear and hand the household
 * straight back to someone just removed from it. A `pending` or `declined` row
 * has to be distinguishable from those, because it is a proposal from a firm
 * that never had access and must not gate the fallback at all.
 *
 * One query answers both questions — "has anything been settled for this
 * login?" and "which households may they open right now?" — because a login
 * has a handful of rows at most, and the alternative is two round trips on
 * every portal request.
 */
export async function listBindingsForUser(clerkUserId: string): Promise<BindingRow[]> {
  if (!clerkUserId) return [];
  return db
    .select({
      bindingId: portalBindings.id,
      clientId: portalBindings.clientId,
      firmId: clients.firmId,
      advisorId: clients.advisorId,
      acceptedAt: portalBindings.acceptedAt,
      status: portalBindings.status,
    })
    .from(portalBindings)
    .innerJoin(clients, eq(clients.id, portalBindings.clientId))
    .where(eq(portalBindings.clerkUserId, clerkUserId))
    // NULLS LAST for the same reason as listActiveBindings above.
    .orderBy(sql`${portalBindings.acceptedAt} DESC NULLS LAST`);
}

export type PendingRequest = {
  bindingId: string;
  clientId: string;
  firmId: string;
  requestedBy: string | null;
  expiresAt: Date | null;
};

/**
 * Un-expired pending requests awaiting this person's decision.
 *
 * A null `expiresAt` means "never expires" (see `isExpired`) — matched here
 * with `isNull(...)` rather than dropped, so a null-expiry pending row is
 * never invisible to the client here while still being acceptable via
 * `acceptBinding` (which shares the same `isExpired` semantics). The
 * alternative — treating null as already-expired — would contradict the
 * explicit "a null expiry never expires" contract `isExpired` publishes.
 */
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
        or(isNull(portalBindings.expiresAt), gt(portalBindings.expiresAt, new Date())),
      ),
    )
    .orderBy(desc(portalBindings.requestedAt));
}

/** Postgres unique-violation (23505). Drizzle wraps every driver error in
 *  `DrizzleQueryError`, whose own `.code` is undefined — the real code lives
 *  on `.cause` (same unwrap as `isUniqueViolation` in
 *  `lib/crm/household-relationships.ts`). `portal_bindings` carries exactly
 *  one unique index (`portal_bindings_live_idx`), so any 23505 raised by an
 *  insert into this table unambiguously means that one. Exported so
 *  `bind-portal-user.ts` can reuse it rather than re-deriving the same
 *  `.cause.code` unwrap for its own `portal_bindings` insert. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23505" || e.cause?.code === "23505";
}

/**
 * Write the `pending` row an advisor's access request creates.
 *
 * Refuses two ways, both by reading first — a cheap common-case answer
 * without attempting a write. But the "live" read can't be the actual gate:
 * two concurrent "Request access" clicks both pass it, so the insert below is
 * ALSO wrapped to catch the partial unique index's rejection and map it to
 * the same `already_live` reason — Postgres, not the read, is what's
 * atomic here.
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
        isNotNull(portalBindings.endedAt),
      ),
    )
    .orderBy(desc(portalBindings.endedAt))
    .limit(1);
  const lastDecline = declined[0]?.endedAt;
  if (lastDecline && cooldownEndsAt(lastDecline).getTime() > Date.now()) {
    return { ok: false, reason: "recently_declined" };
  }

  const now = new Date();
  try {
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
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "already_live" };
    throw err;
  }
}

/**
 * Undo a `pending` row whose access-request email never actually sent.
 *
 * The advisor's request is two writes and only the second one — the email —
 * tells anybody anything. When the send fails the row is a claim nobody made:
 * `createPendingBinding`'s `already_live` guard would then refuse every retry
 * for the full `REQUEST_TTL_DAYS`, with no way to resend.
 *
 * A HARD DELETE, deliberately, not a `revoked` tombstone. `getPortalClientRef`
 * gates its Deploy-1 legacy fallback on the login holding no `active` and no
 * `revoked` row, across every household — so a tombstone from one firm's
 * failed send would suppress that fallback everywhere, and a person whose 0263
 * backfill row went missing on an unrelated household would silently lose
 * access there.
 *
 * Scoped to the HOUSEHOLD as well as the row, the way every other mutator here
 * is scoped to its owner: the caller has the clientId in hand, and without it
 * a stray binding id would be enough to reach another household's pending row.
 *
 * One conditional statement, no read first: `clientId` and `status = 'pending'`
 * both live in the WHERE, so a row a racing accept or decline has already
 * moved off `pending` can never be removed by a late-arriving cleanup.
 * `RETURNING` is what makes the answer honest. Nothing is audited — the send is
 * what audits a request, and it did not happen.
 */
export async function deletePendingBinding(
  bindingId: string,
  clientId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(portalBindings)
    .where(
      and(
        eq(portalBindings.id, bindingId),
        eq(portalBindings.clientId, clientId),
        eq(portalBindings.status, "pending"),
      ),
    )
    .returning({ id: portalBindings.id });
  return Boolean(deleted[0]);
}

/**
 * Promote a pending row to active. ONLY the owning login may call this — the
 * `clerkUserId` predicate is the authorization, not a filter, and it is
 * enforced TWICE: once by the read below (which also produces the specific
 * refusal reason), and again — atomically, together with `status = 'pending'`
 * — by the UPDATE's own WHERE clause. The read alone cannot be the
 * authorization: Accept and Decline racing in two tabs both pass it, so the
 * UPDATE re-checks the same predicate at the moment it writes and is the only
 * thing that actually decides. A caller whose id doesn't own the row, or
 * whose row someone else has already moved off `pending`, gets zero rows
 * back from the UPDATE and nothing is written.
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

  const updated = await db
    .update(portalBindings)
    .set({ status: "active", acceptedAt: new Date() })
    .where(
      and(
        eq(portalBindings.id, bindingId),
        eq(portalBindings.clerkUserId, clerkUserId),
        eq(portalBindings.status, "pending"),
      ),
    )
    .returning({ id: portalBindings.id });
  // Someone else's write (e.g. a concurrent decline) landed between the read
  // above and this UPDATE — the row is honestly no longer pending.
  if (!updated[0]) return { ok: false, reason: "not_pending" };

  await recordAudit({
    action: "portal.access.accepted",
    resourceType: "portal_binding",
    resourceId: bindingId,
    clientId: row.clientId,
    firmId: row.firmId,
    actorId: clerkUserId,
    actorKind: "client",
    metadata: { clerkUserId },
  });

  return { ok: true, clientId: row.clientId };
}

/**
 * Decline a pending request. Starts the re-request cooldown. Same
 * read-then-atomically-re-checked-write shape as `acceptBinding` — see its
 * doc comment for why the read alone isn't the authorization.
 */
export async function declineBinding(bindingId: string, clerkUserId: string): Promise<boolean> {
  const rows = await db
    .select({ clientId: portalBindings.clientId, status: portalBindings.status, firmId: clients.firmId })
    .from(portalBindings)
    .innerJoin(clients, eq(clients.id, portalBindings.clientId))
    .where(and(eq(portalBindings.id, bindingId), eq(portalBindings.clerkUserId, clerkUserId)))
    .limit(1);

  const row = rows[0];
  if (!row || row.status !== "pending") return false;

  const updated = await db
    .update(portalBindings)
    .set({ status: "declined", endedAt: new Date(), endedBy: "client" })
    .where(
      and(
        eq(portalBindings.id, bindingId),
        eq(portalBindings.clerkUserId, clerkUserId),
        eq(portalBindings.status, "pending"),
      ),
    )
    .returning({ id: portalBindings.id });
  if (!updated[0]) return false;

  await recordAudit({
    action: "portal.access.declined",
    resourceType: "portal_binding",
    resourceId: bindingId,
    clientId: row.clientId,
    firmId: row.firmId,
    actorId: clerkUserId,
    actorKind: "client",
    metadata: { clerkUserId },
  });

  return true;
}

/**
 * End an active binding. Writes ONE row and nothing else — the household, its
 * plan, its documents and its audit history are untouched by design.
 *
 * Same read-then-atomically-re-checked-write shape as `acceptBinding`: the
 * UPDATE's WHERE repeats `clientId` + `clerkUserId` + `status = 'active'`
 * rather than trusting the id the read found, so two racing revokes (or an
 * accept racing a revoke) can't both believe they ended the binding — only
 * the one whose UPDATE actually matches a row gets to audit a real change.
 * `RETURNING` is also what makes the return value honest: without it this
 * returned `true` on a no-op write.
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

  const updated = await db
    .update(portalBindings)
    .set({ status: "revoked", endedAt: new Date(), endedBy })
    .where(
      and(
        eq(portalBindings.clientId, clientId),
        eq(portalBindings.clerkUserId, clerkUserId),
        eq(portalBindings.status, "active"),
      ),
    )
    .returning({ id: portalBindings.id });
  if (!updated[0]) return false;

  await recordAudit({
    action: endedBy === "client" ? "portal.access.revoked_by_client" : "portal.access.revoked_by_advisor",
    resourceType: "portal_binding",
    resourceId: updated[0].id,
    clientId,
    firmId: row.firmId,
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
 *
 * Answers ONLY "is there an active binding". It does NOT decide whether the
 * legacy column may still speak for a household that has none — a caller that
 * `?? clients.clerk_user_id` on this answer resurrects a login the advisor or
 * the client just revoked. Use `resolveClientPortalUserId` for that.
 */
export async function getActiveBindingClerkUserId(clientId: string): Promise<string | null> {
  if (!clientId) return null;
  const rows = await db
    .select({ clerkUserId: portalBindings.clerkUserId })
    .from(portalBindings)
    .where(and(eq(portalBindings.clientId, clientId), eq(portalBindings.status, "active")))
    // NULLS LAST for the same reason as listActiveBindings above: an unknown
    // accept time must not win "most recent" over a real one.
    .orderBy(sql`${portalBindings.acceptedAt} DESC NULLS LAST`)
    .limit(1);
  return rows[0]?.clerkUserId ?? null;
}

/** The status facts one binding row contributes to `pickBoundClerkUserId`. */
export type BindingStatusFact = {
  clerkUserId: string;
  status: PortalBindingStatus;
  acceptedAt: Date | null;
};

/**
 * Which login this household is bound to — the ADVISOR-side mirror of
 * `getPortalClientRef`'s Deploy-1 fallback gate (`get-portal-client.ts`).
 *
 * Pure, so the composition every advisor surface performs is testable without
 * a page harness. Two rules, and the second is the one that bites:
 *
 *  1. An `active` binding wins, most recently accepted first — the same
 *     most-recent-wins choice `getActiveBindingClerkUserId` documents.
 *  2. Otherwise the pre-0263 `clients.clerk_user_id` column answers, but ONLY
 *     for a household this table has never SETTLED anything for. A `revoked`
 *     row is history — access existed and was deliberately ended — and
 *     revoking deliberately does not clear that column. Falling through to it
 *     would hand the household straight back to the person just removed from
 *     it, which is how "Remove portal access" becomes a dead button that
 *     re-renders as Active. The portal side suppresses the same fallback for
 *     the same reason; both sides have to agree or one of them is lying.
 *
 * `pending` and `declined` must NOT suppress the fallback: neither is history
 * — one is an unanswered proposal, the other a refused one, both from a firm
 * that never had access — so counting them would let any advisor evict a
 * mid-deploy client from the household they already had, simply by asking.
 */
export function pickBoundClerkUserId(
  rows: BindingStatusFact[],
  legacyClerkUserId: string | null,
): string | null {
  const active = rows
    .filter((r) => r.status === "active")
    // NULLS LAST, by hand: an unknown accept time must not win "most recent"
    // over a real one. Sorted here rather than trusted from the caller's query
    // so the rule holds whatever order the rows arrive in.
    .sort((a, b) => (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0));
  if (active[0]) return active[0].clerkUserId;

  if (rows.some((r) => r.status === "revoked")) return null;
  return legacyClerkUserId;
}

/** What the advisor's Portal access card says about this household. */
export type ManagePortalStatus = "not_invited" | "invited" | "requested" | "active";

/**
 * Rank the household's portal state for Manage Portal.
 *
 * A live request outranks an old invitation because the request is what
 * somebody is actually waiting on, and — unlike an invitation — it writes no
 * column on `clients` at all, so nothing else would ever surface it.
 */
export function rankPortalStatus(args: {
  portalUserId: string | null;
  hasPendingRequest: boolean;
  portalInvitedAt: Date | null;
}): ManagePortalStatus {
  if (args.portalUserId) return "active";
  if (args.hasPendingRequest) return "requested";
  if (args.portalInvitedAt) return "invited";
  return "not_invited";
}

/**
 * The login an advisor surface should act on for this household, or null.
 *
 * THE advisor-side dual-read for Deploy 1. Reads every row for the household
 * in one query — deliberately unfiltered by status, because the `revoked` rows
 * are exactly what decides whether the legacy column may still answer — and
 * applies `pickBoundClerkUserId`. Callers pass their own already-loaded
 * `clients.clerk_user_id`; nothing here re-reads it.
 *
 * Removed in Task 15 along with the column.
 */
export async function resolveClientPortalUserId(
  clientId: string,
  legacyClerkUserId: string | null,
): Promise<string | null> {
  if (!clientId) return null;
  const rows = await db
    .select({
      clerkUserId: portalBindings.clerkUserId,
      status: portalBindings.status,
      acceptedAt: portalBindings.acceptedAt,
    })
    .from(portalBindings)
    .where(eq(portalBindings.clientId, clientId));
  return pickBoundClerkUserId(rows, legacyClerkUserId);
}

/**
 * End every active binding a login holds. Used only when the Clerk account
 * itself is being deleted — a binding pointing at a deleted user can never
 * resolve, so leaving one behind would be a permanently broken row.
 *
 * One statement, no read first: there is nothing to decide per row, and the
 * count comes from `RETURNING` rather than from a preceding SELECT that a
 * concurrent revoke could make stale. `ended_by` is discussed at the call site
 * in the disable route — the column's domain has no value for "their whole
 * login was deleted", so every row records "advisor" and the audit carries the
 * real story.
 *
 * Deliberately audits nothing itself: this ends rows across firms that did not
 * act, and the one advisor action that caused them is audited once by its own
 * route (`portal.access.disabled`, with `mode: "delete_login"`).
 */
export async function revokeAllForUser(clerkUserId: string): Promise<number> {
  if (!clerkUserId) return 0;
  const rows = await db
    .update(portalBindings)
    .set({ status: "revoked", endedAt: new Date(), endedBy: "advisor" })
    .where(and(eq(portalBindings.clerkUserId, clerkUserId), eq(portalBindings.status, "active")))
    .returning({ id: portalBindings.id });
  return rows.length;
}

/**
 * The household's outstanding access request, or null.
 *
 * Manage Portal needs this because an access request writes NO column on
 * `clients` at all: without it the advisor's card reads "Not invited" while a
 * live request sits in the client's inbox, and pressing Send again only earns
 * a 409 about a decline cooldown.
 *
 * "Live" means un-expired, matching `listPendingRequests` — including the
 * null-expiry row, which `isExpired` defines as never expiring.
 */
export async function getPendingRequestForClient(
  clientId: string,
): Promise<{ requestedAt: Date | null } | null> {
  if (!clientId) return null;
  const rows = await db
    .select({ requestedAt: portalBindings.requestedAt })
    .from(portalBindings)
    .where(
      and(
        eq(portalBindings.clientId, clientId),
        eq(portalBindings.status, "pending"),
        or(isNull(portalBindings.expiresAt), gt(portalBindings.expiresAt, new Date())),
      ),
    )
    // NULLS LAST: `requested_at` is nullable and Postgres DESC defaults to
    // NULLS FIRST, so an undated row would outrank a real one and the card
    // would render "Access request sent." with no date on it.
    .orderBy(sql`${portalBindings.requestedAt} DESC NULLS LAST`)
    .limit(1);
  return rows[0] ? { requestedAt: rows[0].requestedAt } : null;
}

/**
 * When the CLIENT last disconnected themselves from this household, or null.
 *
 * `ended_by = 'client'` is the whole point: an advisor who removed access
 * knows they did it, and telling them "disconnected by the client" would be a
 * lie. The column is notNull with default "none", so the predicate is safe on
 * every row, including the 0263 backfill.
 */
export async function getClientDisconnectedAt(clientId: string): Promise<Date | null> {
  if (!clientId) return null;
  const rows = await db
    .select({ endedAt: portalBindings.endedAt })
    .from(portalBindings)
    .where(
      and(
        eq(portalBindings.clientId, clientId),
        eq(portalBindings.status, "revoked"),
        eq(portalBindings.endedBy, "client"),
      ),
    )
    // NULLS LAST for the same reason as listActiveBindings above: a row with
    // no recorded end time must not outrank a genuinely recent one.
    .orderBy(sql`${portalBindings.endedAt} DESC NULLS LAST`)
    .limit(1);
  return rows[0]?.endedAt ?? null;
}
