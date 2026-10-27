// src/lib/fact-finder/worksheet/page-text.ts
// Reaches OCR (readDocumentPages): only chat-turn code imports this. Blob-only helpers live in page-text-store.ts.
import { readDocumentPages } from "../chat/document-text";
import type { ImportFileRow } from "../persist";
import { loadPageText, savePageText } from "./page-text-store";

/**
 * A file's page text, SSN-redacted: the sidecar when it exists, else read from the file (OCR for scans)
 * and saved — so a scanned PDF is read once, not on every chat turn.
 */
export async function documentPages(importId: string, file: ImportFileRow): Promise<string[]> {
  const cached = await loadPageText(importId, file.id);
  if (cached) return cached;
  const pages = await readDocumentPages(file); // already redacted
  await savePageText(importId, file.id, pages);
  return pages;
}
