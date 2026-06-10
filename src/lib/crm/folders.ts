import { db } from "@/db";
import { crmDocumentFolders } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireVaultAccess } from "./authz";

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
