// The one gate every portal PLAN-write handler passes through. Bundles the
// three guards the house pattern already applies in this order —
// identity, then firm subscription, then the advisor's per-client edit toggle —
// and adds the two things the shared write-cores need but `resolvePortalClient`
// does not return: the owning firmId and audit provenance.
//
// Throws rather than returning an error shape, so a handler that forgets to
// check cannot proceed. `authErrorResponse` maps both error types.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { ForbiddenError } from "@/lib/authz";
import { resolvePortalClient } from "./resolve-portal-client";
import { requireEditEnabled } from "./require-edit-enabled";
import { requirePortalActiveSubscription } from "./require-portal-subscription";
import type { PortalActorMode } from "./contracts";

export interface PortalWriteContext {
  clientId: string;
  firmId: string;
  /** Clerk user id of whoever is acting — the client, or the advisor in
   *  "act as client" preview. Lands in `audit_log.actor_id`. */
  actorId: string;
  mode: PortalActorMode;
  /**
   * Provenance for the audit row. Passed to the shared write-cores through
   * their `crossFirmMeta` parameter, which is spread into `metadata` verbatim.
   * The parameter name is a legacy from the cross-firm sharing feature and
   * reads oddly here; renaming it to `extraAuditMeta` across all six write-cores
   * and their advisor call sites is worth doing, but is not this change.
   */
  auditMeta: Record<string, unknown>;
}

export async function resolvePortalWriteContext(): Promise<PortalWriteContext> {
  const { clientId, mode, clerkUserId } = await resolvePortalClient();
  await requirePortalActiveSubscription(clientId);
  await requireEditEnabled(clientId);

  const [row] = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row?.firmId) throw new ForbiddenError("No firm for this client");

  return {
    clientId,
    firmId: row.firmId,
    actorId: clerkUserId,
    mode,
    auditMeta: {
      via: "portal",
      actorKind: mode === "advisor" ? "advisor" : "client",
      ...(mode === "advisor" ? { viaPreview: true } : {}),
    },
  };
}
