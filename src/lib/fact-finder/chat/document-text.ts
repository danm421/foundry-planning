// src/lib/fact-finder/chat/document-text.ts
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { downloadImportFile } from "@/lib/imports/blob";
import type { ImportFileRow } from "../persist";
import { pagesForSectionReader } from "../readers/route-file";

/**
 * A document's page text for the chat's `reread_document` (server-only: blob
 * download, OCR for scans and images). SSNs are redacted on every page before
 * anything else sees it.
 */
export async function readDocumentPages(
  file: Pick<ImportFileRow, "blobUrl" | "originalFilename" | "detectedKind">,
): Promise<string[]> {
  const buffer = await downloadImportFile(file.blobUrl);
  if (!buffer) throw new Error(`Couldn't download "${file.originalFilename}".`);
  const { pages } = await pagesForSectionReader(buffer, file.detectedKind);
  return pages.map((page) => redactSsns(page).text);
}
