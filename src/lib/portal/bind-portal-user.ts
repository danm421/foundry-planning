import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, portalBindings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/portal/bindings";

export type BindResult =
  | { ok: true; clientId: string; firmId: string }
  | { ok: false; reason: "client_not_found" | "already_bound_other" | "revoked" };

/** What `activateBinding` did. `already_active` alone means "nothing to write". */
type Activation = "created" | "promoted" | "already_active" | "blocked" | "revoked";

/**
 * How many times `activateBinding` re-reads after another writer moves this
 * household's rows underneath it. Every pass either decides or observes
 * somebody else's committed change, so two settle any real race and the third
 * is slack. Exhausting it throws rather than guessing: the webhook caller
 * turns that into a 500 and Clerk redelivers.
 */
const MAX_ATTEMPTS = 3;

/**
 * Bring `(clientId, clerkUserId)` to a live `active` binding row, or refuse.
 *
 * `portal_bindings` is the authoritative store for Deploy 1, so this decides
 * from that table and never from the legacy column — with one exception,
 * marked below, for the household whose 0263 backfill row went missing, which
 * the dual-read still serves from that column.
 *
 * The four ways a pair can already appear:
 *  - an `active` row — a genuine replay, nothing to do;
 *  - a `pending` row — an advisor's access request the client has now
 *    answered by accepting the invitation, so it is promoted, not treated as a
 *    conflict (the live index would reject a second row beside it anyway);
 *  - a `declined` row — a proposal refused, from a firm that never had access.
 *    Over, and no obstacle to binding again on EITHER path;
 *  - a `revoked` row — access that once existed and was deliberately ended.
 *    Whether that blocks depends on WHO is asking, which is what `source` is
 *    for. See the guard below.
 */
async function activateBinding(
  clientId: string,
  clerkUserId: string,
  legacyClerkUserId: string | null,
  source: "webhook" | "self-heal",
): Promise<Activation> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await db
      .select({
        id: portalBindings.id,
        clerkUserId: portalBindings.clerkUserId,
        status: portalBindings.status,
      })
      .from(portalBindings)
      .where(eq(portalBindings.clientId, clientId));

    // A `revoked` row for THIS pair is the client's (or their advisor's) own
    // deliberate end of this login's access to this household — the only way
    // that status is ever written is from an `active` one. The middleware
    // self-heal runs automatically on every org-less request and reads a Clerk
    // `publicMetadata.clientId` that nothing ever clears, so without this it
    // re-binds the household the moment the client presses Disconnect, making
    // that button a no-op. The webhook path is the opposite case: an advisor
    // re-inviting is a human act of consent and must still get a working bind
    // rather than a refusal, so it is deliberately unaffected.
    //
    // `declined` is NOT included: it is only ever written from `pending` — a
    // refused proposal from a firm that never had access — and blocking on it
    // would break the one path the self-heal exists for, an invitation whose
    // webhook failed to deliver.
    if (
      source === "self-heal" &&
      rows.some((r) => r.clerkUserId === clerkUserId && r.status === "revoked")
    ) {
      return "revoked";
    }

    const live = rows.filter((r) => r.status === "pending" || r.status === "active");

    // Anti-hijack. One live login per household stays the rule on this path,
    // so any live row belonging to someone else refuses the bind.
    if (live.some((r) => r.clerkUserId !== clerkUserId)) return "blocked";

    // The one legacy-column read left in this function, and only for the
    // household with NO binding row for that login in any status: that is the
    // missing-backfill client `getPortalClientRef` still serves from the
    // column, so their claim is real and binding over it would take the
    // household off them silently. A different login WITH a row is judged by
    // the row above — a revoked or declined one is over and blocks nothing.
    if (
      legacyClerkUserId &&
      legacyClerkUserId !== clerkUserId &&
      !rows.some((r) => r.clerkUserId === legacyClerkUserId)
    ) {
      return "blocked";
    }

    const own = live.find((r) => r.clerkUserId === clerkUserId);
    if (own?.status === "active") return "already_active";

    if (own) {
      const promoted = await db
        .update(portalBindings)
        .set({ status: "active", acceptedAt: new Date() })
        .where(and(eq(portalBindings.id, own.id), eq(portalBindings.status, "pending")))
        .returning({ id: portalBindings.id });
      // Zero rows means someone moved this row off `pending` between the read
      // and the write (a decline in another tab). Re-read and decide again.
      if (promoted[0]) return "promoted";
      continue;
    }

    try {
      await db.insert(portalBindings).values({
        clientId,
        clerkUserId,
        status: "active",
        acceptedAt: new Date(),
      });
      return "created";
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // `portal_bindings_live_idx` is per (client, login), so a 23505 here
      // means a live row for THIS pair appeared between the read and the
      // insert — a redelivered webhook, or an advisor's access request. It
      // says nothing about which status that row holds, and swallowing it
      // would report success over a `pending` row nobody can sign in with.
      // Re-read and let the branches above decide.
    }
  }

  throw new Error(
    `portal binding for client ${clientId} did not settle after ${MAX_ATTEMPTS} attempts`,
  );
}

/**
 * Bind a Clerk login to a Foundry household: brings `portal_bindings` to a
 * live `active` row for the pair, writes the legacy `clients.clerk_user_id`
 * column alongside it (Deploy 1 only), and audits the acceptance once. Single
 * source of truth for activating a portal binding — used by both the
 * `invitation.accepted` webhook and the middleware self-heal path.
 *
 * Returns ok only when that active row exists, so a caller is never told the
 * bind worked while the client is locked out.
 *
 * Anti-hijack: a household whose live binding belongs to a different login is
 * never taken from them. Idempotent: a repeat bind of a pair that is already
 * active writes nothing and audits nothing, so Clerk's webhook retries are
 * safe.
 *
 * `source` is not just audit metadata — it decides one case. The self-heal is
 * automatic and may never undo a deliberate act, so a `revoked` row for this
 * pair refuses it with `reason: "revoked"`; the webhook is an advisor's
 * re-invitation and binds straight over that same row.
 */
export async function bindClerkUserToClient(
  clientId: string,
  clerkUserId: string,
  source: "webhook" | "self-heal",
): Promise<BindResult> {
  const rows = await db
    .select({ firmId: clients.firmId, existing: clients.clerkUserId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const row = rows[0];
  if (!row?.firmId) return { ok: false, reason: "client_not_found" };

  const activation = await activateBinding(clientId, clerkUserId, row.existing, source);
  if (activation === "blocked") return { ok: false, reason: "already_bound_other" };
  if (activation === "revoked") return { ok: false, reason: "revoked" };

  const legacyStale = row.existing !== clerkUserId;
  // Both stores already agree — a genuine replay. No write, no second audit.
  if (activation === "already_active" && !legacyStale) {
    return { ok: true, clientId, firmId: row.firmId };
  }

  if (legacyStale) {
    // DEPLOY-1 DUAL-WRITE. Removed in Task 15 with migration 0264. Keeps a
    // rollback of Deploy 1 — which reads this column and nothing else — from
    // stranding a client who signed up mid-window. It runs after the binding
    // row, so an interrupted bind leaves the store the app actually reads
    // correct, and the next delivery finishes the column.
    await db
      .update(clients)
      .set({ clerkUserId })
      .where(eq(clients.id, clientId));
  }

  await recordAudit({
    action: "portal.invite.accepted",
    resourceType: "portal_binding",
    resourceId: clientId,
    clientId,
    firmId: row.firmId,
    actorId: source === "webhook" ? "clerk:webhook" : "portal:self-heal",
    actorKind: "system",
    metadata: { clerkUserId, source },
  });

  return { ok: true, clientId, firmId: row.firmId };
}
