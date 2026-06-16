// src/domain/copilot/guards.ts
import { db } from "@/db";
import { clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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

/**
 * Resolve the conversation's clientId to its CRM householdId. MUST be called
 * AFTER verifyClientAccess(clientId, firmId): we re-scope the lookup to firmId
 * so a model-echoed clientId can never resolve a household outside the firm.
 * `clients.crmHouseholdId` is uuid NOT NULL UNIQUE (1:1) — a present row always
 * has one. Throws ForbiddenScopeError when no firm-owned client row matches.
 */
export async function clientToHousehold(clientId: string, firmId: string): Promise<string> {
  const row = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.firmId, firmId)),
    columns: { crmHouseholdId: true },
  });
  if (!row?.crmHouseholdId) {
    throw new ForbiddenScopeError(`client ${clientId} (no household in firm)`);
  }
  return row.crmHouseholdId;
}

/**
 * Read-gate for CRM tools: prove the firm may read the conversation's bound
 * client, then resolve+return its householdId. Composes assertClientReadable so
 * the cross-firm + outside-conversation-scope checks run first.
 */
export async function assertHouseholdReadable(ctx: CopilotAuthContext): Promise<string> {
  await assertClientReadable(ctx, ctx.clientId);
  return clientToHousehold(ctx.clientId, ctx.firmId);
}
