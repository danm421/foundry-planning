import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

export type BindResult =
  | { ok: true; clientId: string; firmId: string }
  | { ok: false; reason: "client_not_found" | "already_bound_other" };

/**
 * Bind a Clerk user to a Foundry client (`clients.clerk_user_id`) and audit it.
 * Single source of truth for activating a portal binding — used by both the
 * `invitation.accepted` webhook and the middleware self-heal path.
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
