import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, portalBindings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/portal/bindings";

export type BindResult =
  | { ok: true; clientId: string; firmId: string }
  | { ok: false; reason: "client_not_found" | "already_bound_other" };

/**
 * Bind a Clerk user to a Foundry client: writes an `active` `portal_bindings`
 * row and (Deploy-1 only — see the write below) the legacy
 * `clients.clerk_user_id` column, then audits it. Single source of truth for
 * activating a portal binding — used by both the `invitation.accepted`
 * webhook and the middleware self-heal path.
 *
 * Anti-hijack: never overwrites a clerk_user_id already set to a different user.
 * Idempotent: a repeat bind to the same user is a no-op success.
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

  if (row.existing && row.existing !== clerkUserId) {
    return { ok: false, reason: "already_bound_other" };
  }
  if (row.existing === clerkUserId) {
    // Already bound to this user — nothing to write or audit.
    return { ok: true, clientId, firmId: row.firmId };
  }

  // DEPLOY-1 DUAL-WRITE. Removed in Task 15 with migration 0264 (NOT Task 13
  // — see the plan's task list). Writes the new join-table row and the
  // legacy column together so a rollback of Deploy 1 can't strand a client
  // who signed up mid-window: whichever store the rolled-back code reads,
  // it finds this client already bound.
  //
  // The insert goes first and tolerates a duplicate: a retried webhook
  // delivery (Clerk retries on any non-2xx) can land here a second time
  // after the first attempt's insert succeeded but its column update
  // failed, and `portal_bindings_live_idx` — one live row per (client,
  // login) — would otherwise turn that retry into an unhandled 23505. The
  // anti-hijack check above already proved this clerkUserId is unclaimed or
  // owned by this same client, so a caught duplicate here is never a real
  // hijack, only a replay.
  try {
    await db.insert(portalBindings).values({
      clientId,
      clerkUserId,
      status: "active",
      acceptedAt: new Date(),
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  await db
    .update(clients)
    .set({ clerkUserId })
    .where(eq(clients.id, clientId));

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
