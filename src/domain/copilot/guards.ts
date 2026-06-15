// src/domain/copilot/guards.ts
import { verifyClientAccess } from "@/lib/clients/authz";
import type { CopilotAuthContext } from "./state";

export class ForbiddenScopeError extends Error {
  constructor(detail: string) {
    super(`forbidden_scope: ${detail}`);
    this.name = "ForbiddenScopeError";
  }
}

/**
 * Assert the caller's firm may read `clientId`. Tools call this before any
 * client-scoped read/write so a model-echoed id can never widen scope. Always
 * checks against `ctx.firmId` (server-derived) — never an id from the model.
 * Throws ForbiddenScopeError on a cross-firm or staff-out-of-book client.
 */
export async function assertClientReadable(
  ctx: CopilotAuthContext,
  clientId: string,
): Promise<void> {
  // Pin to the conversation's bound client: a model-echoed id can never widen
  // scope to a different client, even within the same firm (defense in depth
  // beyond the firm tenant check below).
  if (clientId !== ctx.clientId) {
    throw new ForbiddenScopeError(`client ${clientId} (outside conversation scope)`);
  }
  const ok = await verifyClientAccess(clientId, ctx.firmId);
  if (!ok) throw new ForbiddenScopeError(`client ${clientId}`);
}
