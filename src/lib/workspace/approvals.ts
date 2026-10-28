// src/lib/workspace/approvals.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  workspaceConnections,
  workspaceFirmApprovals,
  workspaceMemberAccess,
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

/** Disconnecting a firm removes the approval and everything hanging off it, atomically. */
export async function deleteFirmProvider(firmId: string, provider: WorkspaceProvider): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(workspaceConnections).where(and(eq(workspaceConnections.firmId, firmId), eq(workspaceConnections.provider, provider)));
    await tx.delete(workspaceMemberAccess).where(and(eq(workspaceMemberAccess.firmId, firmId), eq(workspaceMemberAccess.provider, provider)));
    await tx.delete(workspaceOauthStates).where(and(eq(workspaceOauthStates.firmId, firmId), eq(workspaceOauthStates.provider, provider)));
    await tx.delete(workspaceFirmApprovals).where(and(eq(workspaceFirmApprovals.firmId, firmId), eq(workspaceFirmApprovals.provider, provider)));
  });
}
