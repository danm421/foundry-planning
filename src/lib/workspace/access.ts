// src/lib/workspace/access.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceConnections, workspaceMemberAccess } from "@/db/schema";
import type { WorkspaceProvider } from "./types";

export async function listMemberAccess(firmId: string, provider: WorkspaceProvider): Promise<Map<string, boolean>> {
  const rows = await db
    .select({ userId: workspaceMemberAccess.userId, enabled: workspaceMemberAccess.enabled })
    .from(workspaceMemberAccess)
    .where(and(eq(workspaceMemberAccess.firmId, firmId), eq(workspaceMemberAccess.provider, provider)));
  return new Map(rows.map((r) => [r.userId, r.enabled]));
}

export async function hasMemberAccess(firmId: string, userId: string, provider: WorkspaceProvider): Promise<boolean> {
  const [row] = await db
    .select({ enabled: workspaceMemberAccess.enabled })
    .from(workspaceMemberAccess)
    .where(
      and(
        eq(workspaceMemberAccess.firmId, firmId),
        eq(workspaceMemberAccess.userId, userId),
        eq(workspaceMemberAccess.provider, provider),
      ),
    );
  return row?.enabled === true;
}

/** Switching someone off drops their connection in the same transaction. */
export async function setMemberAccess(input: {
  firmId: string;
  provider: WorkspaceProvider;
  userId: string;
  enabled: boolean;
  updatedByUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(workspaceMemberAccess)
      .values(input)
      .onConflictDoUpdate({
        target: [workspaceMemberAccess.firmId, workspaceMemberAccess.userId, workspaceMemberAccess.provider],
        set: { enabled: input.enabled, updatedByUserId: input.updatedByUserId, updatedAt: new Date() },
      });
    if (!input.enabled) {
      await tx
        .delete(workspaceConnections)
        .where(
          and(
            eq(workspaceConnections.firmId, input.firmId),
            eq(workspaceConnections.userId, input.userId),
            eq(workspaceConnections.provider, input.provider),
          ),
        );
    }
  });
}

/** Enables each listed person. Later joiners get no row, so they read as Off. */
export async function enableMembers(input: {
  firmId: string;
  provider: WorkspaceProvider;
  userIds: string[];
  updatedByUserId: string;
}): Promise<number> {
  if (input.userIds.length === 0) return 0;
  await db
    .insert(workspaceMemberAccess)
    .values(
      input.userIds.map((userId) => ({
        firmId: input.firmId,
        provider: input.provider,
        userId,
        enabled: true,
        updatedByUserId: input.updatedByUserId,
      })),
    )
    .onConflictDoUpdate({
      target: [workspaceMemberAccess.firmId, workspaceMemberAccess.userId, workspaceMemberAccess.provider],
      set: { enabled: true, updatedByUserId: input.updatedByUserId, updatedAt: new Date() },
    });
  return input.userIds.length;
}

/** For a person leaving the firm: every provider. */
export async function removeWorkspaceMember(firmId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(workspaceConnections).where(and(eq(workspaceConnections.firmId, firmId), eq(workspaceConnections.userId, userId)));
    await tx.delete(workspaceMemberAccess).where(and(eq(workspaceMemberAccess.firmId, firmId), eq(workspaceMemberAccess.userId, userId)));
  });
}
