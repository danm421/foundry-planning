import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdDocuments } from "@/db/schema";
import { canReadVault, findVisibleCrmHousehold } from "@/lib/crm/authz";
import { downloadImportFile } from "@/lib/imports/blob";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import { toView } from "@/lib/intake/documents";
import {
  storeImportFile,
  MAX_IMPORT_FILE_SIZE_BYTES,
  type ImportFileRow,
} from "@/lib/imports/store-import-file";

/**
 * Documents a client uploaded through Data Collection, offered to the AI import
 * so the advisor doesn't download and re-upload them. They live in the
 * client's vault, so reaching them takes vault access — narrower than the edit
 * access the import routes already prove — and an advisor without it sees an
 * empty list rather than an error.
 */

async function clientHousehold(clientId: string, firmId: string): Promise<string | null> {
  const [client] = await db
    .select({ crmHouseholdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  const householdId = client?.crmHouseholdId ?? null;
  if (!householdId) return null;
  // canReadVault throws on a household the caller can't see at all; asking
  // first turns that case into the same quiet "nothing here" as no vault.
  if (!(await findVisibleCrmHousehold(householdId))) return null;
  return (await canReadVault(householdId)) ? householdId : null;
}

function intakeUploadsOf(householdId: string) {
  return and(
    eq(crmHouseholdDocuments.householdId, householdId),
    eq(crmHouseholdDocuments.sourceKind, "intake_upload"),
    eq(crmHouseholdDocuments.isCurrentVersion, true),
  );
}

export async function listClientIntakeUploads(
  clientId: string,
  firmId: string,
): Promise<IntakeDocumentView[]> {
  const householdId = await clientHousehold(clientId, firmId);
  if (!householdId) return [];

  const rows = await db
    .select()
    .from(crmHouseholdDocuments)
    .where(intakeUploadsOf(householdId))
    .orderBy(desc(crmHouseholdDocuments.createdAt));
  return rows.map(toView);
}

export type AttachIntakeUploadResult =
  | { ok: true; file: ImportFileRow; deduped: boolean }
  | { ok: false; reason: "not_found" | "too_large" | "unsupported_type" };

/** Copy one of the client's intake uploads into the import as an ordinary
 *  import file. A copy, not a pointer: removing it from the import or
 *  discarding the import deletes the import's blob, never the vault's. */
export async function attachIntakeUpload(args: {
  importId: string;
  clientId: string;
  firmId: string;
  documentId: string;
}): Promise<AttachIntakeUploadResult> {
  const householdId = await clientHousehold(args.clientId, args.firmId);
  if (!householdId) return { ok: false, reason: "not_found" };

  const [doc] = await db
    .select()
    .from(crmHouseholdDocuments)
    .where(and(eq(crmHouseholdDocuments.id, args.documentId), intakeUploadsOf(householdId)));
  if (!doc?.storageKey) return { ok: false, reason: "not_found" };
  if ((doc.sizeBytes ?? 0) > MAX_IMPORT_FILE_SIZE_BYTES) return { ok: false, reason: "too_large" };

  const buffer = await downloadImportFile(doc.storageKey);
  if (!buffer) return { ok: false, reason: "not_found" };

  return storeImportFile({
    importId: args.importId,
    clientId: args.clientId,
    firmId: args.firmId,
    filename: doc.filename,
    buffer,
    documentType: "auto",
    auditMetadata: { source: "intake_upload", sourceDocumentId: doc.id },
  });
}
