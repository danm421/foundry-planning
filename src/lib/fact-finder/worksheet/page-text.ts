// src/lib/fact-finder/worksheet/page-text.ts
import { BlobNotFoundError, del, put } from "@vercel/blob";
import { downloadImportFile } from "@/lib/imports/blob";
import { readDocumentPages } from "../chat/document-text";
import type { ImportFileRow } from "../persist";

/** The sidecar holding a file's page text: private Blob, one JSON array of pages. */
export function pageTextPathname(importId: string, fileId: string): string {
  return `imports/${importId}/${fileId}.pages.json`;
}

/** Pages must already be SSN-redacted. Overwrites an earlier sidecar for the file. */
export async function savePageText(importId: string, fileId: string, pages: string[]): Promise<void> {
  await put(pageTextPathname(importId, fileId), JSON.stringify(pages), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function loadPageText(importId: string, fileId: string): Promise<string[] | null> {
  const buffer = await downloadImportFile(pageTextPathname(importId, fileId));
  if (!buffer) return null;
  try {
    const parsed: unknown = JSON.parse(buffer.toString("utf8"));
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string") ? parsed : null;
  } catch {
    return null;
  }
}

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

/** Removes a file's sidecar; a file that never had one is fine. */
export async function deletePageText(importId: string, fileId: string): Promise<void> {
  try {
    await del(pageTextPathname(importId, fileId));
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
}
