// src/lib/workspace/approvals.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  workspaceConnections,
  workspaceFirmApprovals,
  workspaceOauthStates,
} from "@/db/schema";
import type { WorkspaceProvider } from "./types";

export async function getFirmApproval(
  firmId: string,
  provider: WorkspaceProvider,
): Promise<{ tenantId: string; approvedScopes: string; approvedAt: Date } | null> {
  const [row] = await db
    .select({
      tenantId: workspaceFirmApprovals.tenantId,
      approvedScopes: workspaceFirmApprovals.approvedScopes,
      approvedAt: workspaceFirmApprovals.approvedAt,
    })
    .from(workspaceFirmApprovals)
    .where(and(eq(workspaceFirmApprovals.firmId, firmId), eq(workspaceFirmApprovals.provider, provider)));
  return row ?? null;
}

/**
 * Re-approving from a different tenant leaves advisors' connections alone:
 * advisors now sign in from any organization, so a connection is not tied to
 * the firm's approved tenant.
 */
export async function upsertFirmApproval(input: {
  firmId: string;
  provider: WorkspaceProvider;
  tenantId: string;
  approvedScopes: string;
  approvedByUserId: string;
}): Promise<void> {
  await db
    .insert(workspaceFirmApprovals)
    .values(input)
    .onConflictDoUpdate({
      target: [workspaceFirmApprovals.firmId, workspaceFirmApprovals.provider],
      set: {
        tenantId: input.tenantId,
        approvedScopes: input.approvedScopes,
        approvedByUserId: input.approvedByUserId,
        approvedAt: new Date(),
      },
    });
}

/**
 * "Disconnect everyone": every advisor's connected addresses, pending
 * sign-ins and the approval, every provider, atomically. Resolves to the
 * removed addresses' ids, for the audit.
 */
export async function deleteFirmWorkspace(
  firmId: string,
): Promise<Array<{ id: string; provider: WorkspaceProvider; userId: string }>> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(workspaceConnections)
      .where(eq(workspaceConnections.firmId, firmId))
      .returning({
        id: workspaceConnections.id,
        provider: workspaceConnections.provider,
        userId: workspaceConnections.userId,
      });
    await tx.delete(workspaceOauthStates).where(eq(workspaceOauthStates.firmId, firmId));
    await tx.delete(workspaceFirmApprovals).where(eq(workspaceFirmApprovals.firmId, firmId));
    return removed;
  });
}
