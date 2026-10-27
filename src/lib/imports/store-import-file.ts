import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles } from "@/db/schema";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { uploadImportFile } from "@/lib/imports/blob";
import { sha256Hex } from "@/lib/imports/file-hash";
import { recordAudit } from "@/lib/audit";

export type ImportFileRow = typeof clientImportFiles.$inferSelect;

export type StoreImportFileResult =
  | { ok: true; file: ImportFileRow; deduped: boolean }
  | { ok: false; reason: "unsupported_type" };

/**
 * Persist bytes as one file of an import: magic-byte check, content-hash dedup,
 * blob upload, row, audit. Shared by the advisor's own upload and by attaching
 * a document the client uploaded through Data Collection, so a file reaches
 * extraction the same way whichever door it came in by. The caller has already
 * authorized the import and enforced its own size cap.
 */
export async function storeImportFile(args: {
  importId: string;
  clientId: string;
  firmId: string;
  filename: string;
  buffer: Buffer;
  documentType: ImportFileRow["documentType"];
  /** Extra audit metadata — where the bytes came from, when not a fresh upload. */
  auditMetadata?: Record<string, unknown>;
}): Promise<StoreImportFileResult> {
  const { importId, clientId, firmId, filename, buffer, documentType } = args;

  // Magic-byte detection — refuse anything we can't safely parse later
  // even if the filename extension says otherwise.
  const kind = detectUploadKind(buffer);
  if (!kind) return { ok: false, reason: "unsupported_type" };

  // Content-hash dedup within this import. If the advisor uploads the
  // same file twice (common with browser drag-and-drop retries), we
  // return the existing row instead of re-uploading to blob storage.
  const hash = await sha256Hex(buffer);
  const [existing] = await db
    .select()
    .from(clientImportFiles)
    .where(
      and(
        eq(clientImportFiles.importId, importId),
        eq(clientImportFiles.contentHash, hash),
        isNull(clientImportFiles.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return { ok: true, file: existing, deduped: true };

  const fileId = crypto.randomUUID();
  const { url: blobUrl, pathname: blobPathname } = await uploadImportFile({
    importId,
    fileId,
    filename,
    body: buffer,
  });

  const [row] = await db
    .insert(clientImportFiles)
    .values({
      id: fileId,
      importId,
      blobUrl,
      blobPathname,
      originalFilename: filename,
      contentHash: hash,
      sizeBytes: buffer.length,
      detectedKind: kind,
      documentType,
    })
    .returning();

  await recordAudit({
    action: "import.file.uploaded",
    resourceType: "client_import_file",
    resourceId: fileId,
    clientId,
    firmId,
    metadata: {
      importId,
      contentHash: hash,
      sizeBytes: buffer.length,
      detectedKind: kind,
      documentType,
      ...args.auditMetadata,
    },
  });

  return { ok: true, file: row, deduped: false };
}
