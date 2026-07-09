import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmDocumentFolders, crmHouseholdDocuments } from "@/db/schema";
import { collectFolderSubtreeIds } from "@/lib/crm/folder-tree";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit/record-helpers";
import type { EntitySnapshot, FieldLabels } from "@/lib/audit/types";
import {
  resolvePortalVaultContext,
  assertInSubtree,
  PortalVaultNotFoundError,
  type PortalVaultContext,
} from "./vault-context";

export type PortalFolderDTO = {
  id: string;
  name: string;
  parentFolderId: string | null;
  sortOrder: number;
  isRoot: boolean;
};

function actorKind(ctx: PortalVaultContext): "advisor" | "client" {
  return ctx.mode === "advisor" ? "advisor" : "client";
}
const viaPreview = (ctx: PortalVaultContext) => (ctx.mode === "advisor" ? { viaPreview: true } : undefined);

const FOLDER_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  parentFolderId: { label: "Parent folder", format: "reference" },
};

async function requireFolderInSubtree(ctx: PortalVaultContext, folderId: string) {
  assertInSubtree(ctx.subtree, folderId);
  const folder = await db.query.crmDocumentFolders.findFirst({
    where: and(eq(crmDocumentFolders.id, folderId), eq(crmDocumentFolders.householdId, ctx.householdId)),
  });
  if (!folder) throw new PortalVaultNotFoundError();
  return folder;
}

export async function listPortalFolders(): Promise<{ rootId: string; folders: PortalFolderDTO[] }> {
  const ctx = await resolvePortalVaultContext();
  const rows = await db.query.crmDocumentFolders.findMany({
    where: eq(crmDocumentFolders.householdId, ctx.householdId),
    columns: { id: true, name: true, parentFolderId: true, sortOrder: true },
  });
  const folders = rows
    .filter((f) => ctx.subtree.has(f.id))
    .map((f) => ({
      id: f.id,
      // The root is the client's top level — present it neutrally, not by its CRM name.
      name: f.id === ctx.sharedRootId ? "My Documents" : f.name,
      parentFolderId: f.id === ctx.sharedRootId ? null : f.parentFolderId,
      sortOrder: f.sortOrder,
      isRoot: f.id === ctx.sharedRootId,
    }));
  return { rootId: ctx.sharedRootId, folders };
}

export async function createPortalFolder(
  input: { name: string; parentFolderId: string | null },
): Promise<PortalFolderDTO> {
  const ctx = await resolvePortalVaultContext();
  const parent = input.parentFolderId ?? ctx.sharedRootId;
  assertInSubtree(ctx.subtree, parent);
  const name = input.name.trim();
  if (!name) throw new Error("Folder name is required");
  const [folder] = await db.insert(crmDocumentFolders).values({
    householdId: ctx.householdId,
    firmId: ctx.firmId,
    name,
    parentFolderId: parent,
    isSystem: false,
    isPortalRoot: false,
  }).returning();
  await recordCreate({
    action: "portal.folder.create",
    resourceType: "crm_document_folder",
    resourceId: folder.id,
    clientId: ctx.clientId,
    firmId: ctx.firmId,
    actorKind: actorKind(ctx),
    extraMetadata: viaPreview(ctx),
    snapshot: { name, parentFolderId: parent },
  });
  return { id: folder.id, name: folder.name, parentFolderId: folder.parentFolderId, sortOrder: folder.sortOrder, isRoot: false };
}

export async function updatePortalFolder(
  folderId: string,
  patch: { name?: string; parentFolderId?: string },
): Promise<PortalFolderDTO> {
  const ctx = await resolvePortalVaultContext();
  if (folderId === ctx.sharedRootId) throw new Error("Cannot modify the shared root folder");
  const folder = await requireFolderInSubtree(ctx, folderId);
  const updates: Partial<typeof crmDocumentFolders.$inferInsert> = { updatedAt: new Date() };
  const before: EntitySnapshot = {};
  const after: EntitySnapshot = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Folder name is required");
    updates.name = name; before.name = folder.name; after.name = name;
  }
  if (patch.parentFolderId !== undefined) {
    const dest = patch.parentFolderId;
    // Fail-fast against the request-scoped snapshot; the authoritative check
    // is re-run inside the transaction below against freshly locked data.
    assertInSubtree(ctx.subtree, dest);
    updates.parentFolderId = dest; before.parentFolderId = folder.parentFolderId; after.parentFolderId = dest;
  }

  const updated = await db.transaction(async (tx) => {
    if (patch.parentFolderId !== undefined) {
      const dest = patch.parentFolderId;
      // Re-check the cycle/subtree guard here, against data read (and
      // locked) inside this same transaction, so the check and the write
      // commit atomically. Without this, two concurrent moves — folder A
      // into B, and folder B into A — can each pass the guard against a
      // pre-move snapshot and then both persist, producing a folder cycle
      // that hangs every future subtree computation for the household
      // (collectFolderSubtreeIds has no visited-set), and
      // resolvePortalVaultContext runs one on every portal request. Plain
      // transaction-wrapping alone doesn't close this: the two moves touch
      // disjoint rows, so their row-level UPDATE locks never conflict.
      // `.for("update")` locks every folder row for this household for the
      // duration of the transaction, so a concurrent mover blocks here
      // until this transaction commits (or rolls back) and then re-reads
      // the post-commit state — same pattern as the check-then-act guard in
      // ownership.ts (_applyToAccount/_applyToLiability).
      const all = await tx
        .select()
        .from(crmDocumentFolders)
        .where(eq(crmDocumentFolders.householdId, ctx.householdId))
        .for("update");
      const freshSubtree = new Set(collectFolderSubtreeIds(all, ctx.sharedRootId));
      assertInSubtree(freshSubtree, dest);
      const descendants = new Set(collectFolderSubtreeIds(all, folderId));
      if (descendants.has(dest)) throw new Error("Move would create a folder cycle");
    }
    const [row] = await tx.update(crmDocumentFolders).set(updates)
      .where(and(eq(crmDocumentFolders.id, folderId), eq(crmDocumentFolders.householdId, ctx.householdId)))
      .returning();
    return row;
  });
  await recordUpdate({
    action: "portal.folder.update",
    resourceType: "crm_document_folder",
    resourceId: folderId,
    clientId: ctx.clientId,
    firmId: ctx.firmId,
    actorKind: actorKind(ctx),
    extraMetadata: viaPreview(ctx),
    before, after, fieldLabels: FOLDER_FIELD_LABELS,
  });
  return { id: updated.id, name: updated.name, parentFolderId: updated.parentFolderId, sortOrder: updated.sortOrder, isRoot: false };
}

export async function deletePortalFolder(folderId: string): Promise<void> {
  const ctx = await resolvePortalVaultContext();
  if (folderId === ctx.sharedRootId) throw new Error("Cannot delete the shared root folder");
  const folder = await requireFolderInSubtree(ctx, folderId);
  // folder is in-subtree and not the root, so parentFolderId is non-null and in-subtree.
  const reHome = folder.parentFolderId ?? ctx.sharedRootId;
  await db.transaction(async (tx) => {
    await tx.update(crmDocumentFolders)
      .set({ parentFolderId: reHome, updatedAt: new Date() })
      .where(and(eq(crmDocumentFolders.householdId, ctx.householdId), eq(crmDocumentFolders.parentFolderId, folderId)));
    await tx.update(crmHouseholdDocuments)
      .set({ folderId: reHome })
      .where(and(eq(crmHouseholdDocuments.householdId, ctx.householdId), eq(crmHouseholdDocuments.folderId, folderId)));
    await tx.delete(crmDocumentFolders).where(eq(crmDocumentFolders.id, folderId));
  });
  await recordDelete({
    action: "portal.folder.delete",
    resourceType: "crm_document_folder",
    resourceId: folderId,
    clientId: ctx.clientId,
    firmId: ctx.firmId,
    actorKind: actorKind(ctx),
    extraMetadata: viaPreview(ctx),
    snapshot: { name: folder.name },
  });
}
