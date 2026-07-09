import { db } from "@/db";
import { crmDocumentFolders, crmHouseholdDocuments } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireVaultAccess } from "./authz";
import { recordAudit } from "@/lib/audit";

export const SYSTEM_FOLDERS = [
  "Plans",
  "Statements",
  "Tax",
  "Insurance",
  "Estate",
  "Imported Documents",
  "Transcripts",
] as const;

export type CrmDocumentFolderRow = typeof crmDocumentFolders.$inferSelect;

/** Idempotently create the system folder set for a household. */
export async function ensureSystemFolders(householdId: string, firmId: string) {
  const existing = await db.query.crmDocumentFolders.findFirst({
    where: and(
      eq(crmDocumentFolders.householdId, householdId),
      eq(crmDocumentFolders.isSystem, true),
    ),
  });
  if (existing) return;
  await db.insert(crmDocumentFolders).values(
    SYSTEM_FOLDERS.map((name, i) => ({
      householdId,
      firmId,
      name,
      isSystem: true,
      sortOrder: i,
    })),
  );
}

/** Find-or-create the household's "Transcripts" system folder. Idempotent on the
 *  specific folder (unlike ensureSystemFolders, which bails if ANY system folder
 *  exists — so it would skip backfilling Transcripts for pre-existing households). */
export async function ensureTranscriptsFolder(
  householdId: string,
  firmId: string,
): Promise<string> {
  const existing = await db.query.crmDocumentFolders.findFirst({
    where: and(
      eq(crmDocumentFolders.householdId, householdId),
      eq(crmDocumentFolders.name, "Transcripts"),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;
  const [folder] = await db
    .insert(crmDocumentFolders)
    .values({ householdId, firmId, name: "Transcripts", isSystem: true })
    .returning({ id: crmDocumentFolders.id });
  return folder.id;
}

export const MEETING_PREP_FOLDER_NAME = "Meeting Prep";

/** Find-or-create the household's "Meeting Prep" system folder. Mirrors
 *  ensureTranscriptsFolder (idempotent on this specific folder, unlike
 *  ensureSystemFolders which bails if ANY system folder exists). */
export async function ensureMeetingPrepFolder(
  householdId: string,
  firmId: string,
): Promise<string> {
  const existing = await db.query.crmDocumentFolders.findFirst({
    where: and(
      eq(crmDocumentFolders.householdId, householdId),
      eq(crmDocumentFolders.name, MEETING_PREP_FOLDER_NAME),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;
  const [folder] = await db
    .insert(crmDocumentFolders)
    .values({ householdId, firmId, name: MEETING_PREP_FOLDER_NAME, isSystem: true })
    .returning({ id: crmDocumentFolders.id });
  return folder.id;
}

export const PORTAL_SHARED_FOLDER_NAME = "Shared with Client";

/** Find-or-create the household's single portal-shared root folder. Idempotent
 *  on the specific folder (mirrors ensureTranscriptsFolder). The partial unique
 *  index `crm_doc_folders_one_portal_root_per_hh` is the DB-level backstop. */
export async function ensureSharedFolder(
  householdId: string,
  firmId: string,
): Promise<string> {
  const existing = await db.query.crmDocumentFolders.findFirst({
    where: and(
      eq(crmDocumentFolders.householdId, householdId),
      eq(crmDocumentFolders.isPortalRoot, true),
    ),
    columns: { id: true },
  });
  if (existing) return existing.id;
  const [folder] = await db
    .insert(crmDocumentFolders)
    .values({
      householdId,
      firmId,
      name: PORTAL_SHARED_FOLDER_NAME,
      isSystem: true,
      isPortalRoot: true,
    })
    .returning({ id: crmDocumentFolders.id });
  return folder.id;
}

export async function listFolders(
  householdId: string,
): Promise<CrmDocumentFolderRow[]> {
  const { orgId } = await requireVaultAccess(householdId);
  await ensureSystemFolders(householdId, orgId);
  await ensureSharedFolder(householdId, orgId);
  return db.query.crmDocumentFolders.findMany({
    where: eq(crmDocumentFolders.householdId, householdId),
    orderBy: [asc(crmDocumentFolders.sortOrder), asc(crmDocumentFolders.createdAt)],
  });
}

export async function createFolder(
  householdId: string,
  input: { name: string; parentFolderId?: string | null },
): Promise<CrmDocumentFolderRow> {
  const { orgId } = await requireVaultAccess(householdId);
  const name = input.name.trim();
  if (!name) throw new Error("Folder name is required");

  // If a parent is given, it must belong to this household.
  if (input.parentFolderId) {
    const parent = await db.query.crmDocumentFolders.findFirst({
      where: and(
        eq(crmDocumentFolders.id, input.parentFolderId),
        eq(crmDocumentFolders.householdId, householdId),
      ),
    });
    if (!parent) throw new Error("Parent folder not found in this household");
  }

  const [folder] = await db
    .insert(crmDocumentFolders)
    .values({
      householdId,
      firmId: orgId,
      name,
      parentFolderId: input.parentFolderId ?? null,
      isSystem: false,
    })
    .returning();

  await recordAudit({
    action: "vault.folder.create",
    resourceType: "crm_document_folder",
    resourceId: folder.id,
    firmId: orgId,
    metadata: { name, parentFolderId: input.parentFolderId ?? null },
  });

  return folder;
}

/** Walk up from `candidateParentId`; if we reach `folderId`, the move would
 *  create a cycle. Also treats self-parenting as a cycle. */
async function wouldCreateCycle(
  householdId: string,
  folderId: string,
  candidateParentId: string,
): Promise<boolean> {
  if (candidateParentId === folderId) return true;
  let cursor: string | null = candidateParentId;
  // Bound the walk to the folder count to avoid infinite loops on corrupt data.
  for (let guard = 0; cursor && guard < 10_000; guard++) {
    if (cursor === folderId) return true;
    const ancestor: Pick<CrmDocumentFolderRow, "parentFolderId"> | undefined =
      await db.query.crmDocumentFolders.findFirst({
        where: and(
          eq(crmDocumentFolders.id, cursor),
          eq(crmDocumentFolders.householdId, householdId),
        ),
        columns: { parentFolderId: true },
      });
    cursor = ancestor?.parentFolderId ?? null;
  }
  return false;
}

export async function updateFolder(
  householdId: string,
  folderId: string,
  patch: { name?: string; parentFolderId?: string | null },
): Promise<CrmDocumentFolderRow> {
  const { orgId } = await requireVaultAccess(householdId);

  const folder = await db.query.crmDocumentFolders.findFirst({
    where: and(
      eq(crmDocumentFolders.id, folderId),
      eq(crmDocumentFolders.householdId, householdId),
    ),
  });
  if (!folder) throw new Error("Folder not found in this household");

  const updates: Partial<typeof crmDocumentFolders.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (patch.name !== undefined) {
    if (folder.isSystem) throw new Error("Cannot rename a system folder");
    const name = patch.name.trim();
    if (!name) throw new Error("Folder name is required");
    updates.name = name;
  }

  if (patch.parentFolderId !== undefined) {
    const newParent = patch.parentFolderId;
    if (newParent) {
      const exists = await db.query.crmDocumentFolders.findFirst({
        where: and(
          eq(crmDocumentFolders.id, newParent),
          eq(crmDocumentFolders.householdId, householdId),
        ),
        columns: { id: true },
      });
      if (!exists) throw new Error("Destination folder not found in this household");
      if (await wouldCreateCycle(householdId, folderId, newParent)) {
        throw new Error("Move would create a folder cycle (descendant of itself)");
      }
    }
    updates.parentFolderId = newParent;
  }

  const [updated] = await db
    .update(crmDocumentFolders)
    .set(updates)
    .where(
      and(
        eq(crmDocumentFolders.id, folderId),
        eq(crmDocumentFolders.householdId, householdId),
      ),
    )
    .returning();

  await recordAudit({
    action: "vault.folder.rename",
    resourceType: "crm_document_folder",
    resourceId: folderId,
    firmId: orgId,
    metadata: { name: patch.name, parentFolderId: patch.parentFolderId },
  });

  return updated;
}

export async function deleteFolder(
  householdId: string,
  folderId: string,
): Promise<void> {
  const { orgId } = await requireVaultAccess(householdId);

  const folder = await db.query.crmDocumentFolders.findFirst({
    where: and(
      eq(crmDocumentFolders.id, folderId),
      eq(crmDocumentFolders.householdId, householdId),
    ),
  });
  if (!folder) throw new Error("Folder not found in this household");
  if (folder.isSystem) throw new Error("Cannot delete a system folder");

  await db.transaction(async (tx) => {
    // Child folders re-parent to this folder's parent (grandparent).
    await tx
      .update(crmDocumentFolders)
      .set({ parentFolderId: folder.parentFolderId, updatedAt: new Date() })
      .where(
        and(
          eq(crmDocumentFolders.householdId, householdId),
          eq(crmDocumentFolders.parentFolderId, folderId),
        ),
      );
    // Contained documents fall to root (folderId = null). The FK is
    // ON DELETE set null, but we do it explicitly so it's transactional
    // and not dependent on delete ordering.
    await tx
      .update(crmHouseholdDocuments)
      .set({ folderId: null })
      .where(
        and(
          eq(crmHouseholdDocuments.householdId, householdId),
          eq(crmHouseholdDocuments.folderId, folderId),
        ),
      );
    await tx
      .delete(crmDocumentFolders)
      .where(eq(crmDocumentFolders.id, folderId));
  });

  await recordAudit({
    action: "vault.folder.delete",
    resourceType: "crm_document_folder",
    resourceId: folderId,
    firmId: orgId,
    metadata: { name: folder.name },
  });
}
