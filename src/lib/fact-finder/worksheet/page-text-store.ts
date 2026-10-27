// src/lib/fact-finder/worksheet/page-text-store.ts
// Blob-only on purpose: the file DELETE route imports this, and must not reach OCR (see page-text.ts).
import { BlobNotFoundError, del, put } from "@vercel/blob";
import { downloadImportFile } from "@/lib/imports/blob";

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

/** The saved pages, or null when there is no sidecar or it isn't a list of strings. */
export async function loadPageText(importId: string, fileId: string): Promise<string[] | null> {
  const buffer = await downloadImportFile(pageTextPathname(importId, fileId));
  if (!buffer) return null;
  try {
    const parsed: unknown = JSON.parse(buffer.toString("utf8"));
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string") ? parsed : null;
  } catch {
    return null;
  }
}

/** Removes a file's sidecar; a file that never had one is fine. */
export async function deletePageText(importId: string, fileId: string): Promise<void> {
  try {
    await del(pageTextPathname(importId, fileId));
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
}
