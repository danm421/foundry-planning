import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmDocumentFolders } from "@/db/schema";
import { collectFolderSubtreeIds } from "@/lib/crm/folder-tree";
import { ensureSharedFolder } from "@/lib/crm/folders";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { authErrorResponse } from "@/lib/authz";

/** Target folder/doc is outside the client's shared subtree (or missing).
 *  Routes map this to 404 so cross-boundary existence never leaks. */
export class PortalVaultNotFoundError extends Error {
  constructor(msg = "Not found") {
    super(msg);
    this.name = "PortalVaultNotFoundError";
  }
}

export type PortalVaultContext = {
  clientId: string;
  mode: "client" | "advisor";
  clerkUserId: string;
  householdId: string;
  firmId: string;
  sharedRootId: string;
  subtree: Set<string>;
};

/** All folder ids in the household that live in the shared subtree (inclusive). */
export async function loadSharedSubtreeFolderIds(
  householdId: string,
  sharedRootId: string,
): Promise<Set<string>> {
  const folders = await db.query.crmDocumentFolders.findMany({
    where: eq(crmDocumentFolders.householdId, householdId),
    columns: { id: true, name: true, parentFolderId: true, sortOrder: true },
  });
  return new Set(collectFolderSubtreeIds(folders, sharedRootId));
}

/** Throws unless `folderId` is a non-null member of the shared subtree. */
export function assertInSubtree(
  subtree: Set<string>,
  folderId: string | null,
): asserts folderId is string {
  if (folderId === null || !subtree.has(folderId)) {
    throw new PortalVaultNotFoundError();
  }
}

/** Resolve the caller → household/firm → shared root → subtree id-set. */
export async function resolvePortalVaultContext(): Promise<PortalVaultContext> {
  const { clientId, mode, clerkUserId } = await resolvePortalClient();
  const [row] = await db
    .select({ householdId: clients.crmHouseholdId, firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row?.householdId || !row.firmId) throw new PortalVaultNotFoundError();
  const sharedRootId = await ensureSharedFolder(row.householdId, row.firmId);
  const subtree = await loadSharedSubtreeFolderIds(row.householdId, sharedRootId);
  return {
    clientId, mode, clerkUserId,
    householdId: row.householdId, firmId: row.firmId,
    sharedRootId, subtree,
  };
}

/** Route error mapper: NotFound → 404, else auth (401/403), else null. */
export function portalVaultErrorResponse(
  err: unknown,
): { status: number; body: { error: string } } | null {
  if (err instanceof PortalVaultNotFoundError) {
    return { status: 404, body: { error: "Not found" } };
  }
  return authErrorResponse(err);
}
