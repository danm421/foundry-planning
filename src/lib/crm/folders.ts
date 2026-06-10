import { db } from "@/db";
import { crmDocumentFolders } from "@/db/schema";
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
] as const;

export type CrmDocumentFolderRow = typeof crmDocumentFolders.$inferSelect;

/** Idempotently create the system folder set for a household. */
async function ensureSystemFolders(householdId: string, firmId: string) {
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

export async function listFolders(
  householdId: string,
): Promise<CrmDocumentFolderRow[]> {
  const { orgId } = await requireVaultAccess(householdId);
  await ensureSystemFolders(householdId, orgId);
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
