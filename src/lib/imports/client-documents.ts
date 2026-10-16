import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdDocuments } from "@/db/schema";
import { canReadVault, findVisibleCrmHousehold } from "@/lib/crm/authz";
import { downloadImportFile } from "@/lib/imports/blob";
import { UPLOADED_SOURCE_KINDS, portalUploadPrefix } from "@/lib/crm/document-constants";
import { intakeDocTypeLabel } from "@/lib/intake/document-types";
import {
  storeImportFile,
  MAX_IMPORT_FILE_SIZE_BYTES,
  type ImportFileRow,
} from "@/lib/imports/store-import-file";

/**
 * Files in the client's vault, offered to the AI import so the advisor doesn't
 * download and re-upload them — whatever the client sent through Data
 * Collection or the portal, and whatever the firm filed there itself. Reaching
 * them takes vault access — narrower than the edit access the import routes
 * already prove — and an advisor without it sees an empty list rather than an
 * error.
 */

/** Where a vault file came from, shown beside it in the upload box. */
export type ClientDocumentSource = "data_collection" | "portal" | "firm";

export interface ClientDocumentView {
  id: string;
  filename: string;
  sizeBytes: number | null;
  source: ClientDocumentSource;
  /** The type the client picked in Data Collection. Other uploads have none —
   *  their description is the firm's free-text note, not a type. */
  typeLabel: string | null;
}

// What the import reads: its own file picker's types, less legacy .xls, which
// `detectUploadKind` refuses. The vault also takes HEIC photos, old Office
// files and slides — they're left off the list rather than offered to fail.
const IMPORTABLE_FILENAME = /\.(pdf|png|jpe?g|docx|xlsx|csv)$/i;

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

function vaultUploadsOf(householdId: string) {
  return and(
    eq(crmHouseholdDocuments.householdId, householdId),
    inArray(crmHouseholdDocuments.sourceKind, UPLOADED_SOURCE_KINDS),
    eq(crmHouseholdDocuments.isCurrentVersion, true),
  );
}

type DocumentRow = typeof crmHouseholdDocuments.$inferSelect;

function sourceOf(row: DocumentRow, householdId: string): ClientDocumentSource {
  if (row.sourceKind === "intake_upload") return "data_collection";
  return row.storageKey?.startsWith(portalUploadPrefix(householdId)) ? "portal" : "firm";
}

export async function listClientDocuments(
  clientId: string,
  firmId: string,
): Promise<ClientDocumentView[]> {
  const householdId = await clientHousehold(clientId, firmId);
  if (!householdId) return [];

  const rows = await db
    .select()
    .from(crmHouseholdDocuments)
    .where(vaultUploadsOf(householdId))
    .orderBy(desc(crmHouseholdDocuments.createdAt));
  return rows
    .filter(
      (row) =>
        row.storageKey &&
        IMPORTABLE_FILENAME.test(row.filename) &&
        (row.sizeBytes ?? 0) <= MAX_IMPORT_FILE_SIZE_BYTES,
    )
    .map((row) => ({
      id: row.id,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      source: sourceOf(row, householdId),
      typeLabel: row.sourceKind === "intake_upload" ? intakeDocTypeLabel(row.description) : null,
    }));
}

export type AttachClientDocumentResult =
  | { ok: true; file: ImportFileRow; deduped: boolean }
  | { ok: false; reason: "not_found" | "too_large" | "unsupported_type" };

/** Copy one of the client's vault files into the import as an ordinary import
 *  file. A copy, not a pointer: removing it from the import or discarding the
 *  import deletes the import's blob, never the vault's. */
export async function attachClientDocument(args: {
  importId: string;
  clientId: string;
  firmId: string;
  documentId: string;
}): Promise<AttachClientDocumentResult> {
  const householdId = await clientHousehold(args.clientId, args.firmId);
  if (!householdId) return { ok: false, reason: "not_found" };

  const [doc] = await db
    .select()
    .from(crmHouseholdDocuments)
    .where(and(eq(crmHouseholdDocuments.id, args.documentId), vaultUploadsOf(householdId)));
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
    auditMetadata: { source: "vault_document", sourceDocumentId: doc.id },
  });
}
