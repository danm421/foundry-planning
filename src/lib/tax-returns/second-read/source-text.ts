import { getCrmDocument, resolveDocumentBlobPathname } from "@/lib/crm/documents";
import { downloadImportFile } from "@/lib/imports/blob";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { readDocumentText } from "../document-text";

export interface DocumentSource {
  documentId: string;
  role: string;
  filename: string | null;
  text: string;
}

export interface SourceTextResult {
  sources: DocumentSource[];
  warnings: string[];
}

export interface SourceDocument {
  id: string;
  role: string;
  filename: string | null;
  vaultDocumentId: string | null;
}

function unreadable(filename: string | null): string {
  return filename
    ? `${filename} couldn't be read from the document vault.`
    : "A document couldn't be read from the document vault.";
}

/**
 * Re-derive each document's text by downloading its bytes back out of the CRM
 * vault. Nothing is persisted per document, which is why adding the second
 * read needs no migration.
 *
 * Every failure degrades to a warning and skips that document. A scanned K-1
 * whose OCR fails, a best-effort vault save that returned null, a blob whose
 * link went stale — none of them may take down a run over the documents that
 * DID read. The warnings ride along into the panel so "nothing found" is never
 * mistaken for "nothing looked at".
 *
 * `mimeType` on the vault row is hard-coded `application/pdf` by
 * `savePlanToVault` regardless of what was uploaded, so the kind is
 * re-detected from the bytes rather than trusted.
 */
export async function loadDocumentSourceText(
  documents: SourceDocument[],
): Promise<SourceTextResult> {
  const sources: DocumentSource[] = [];
  const warnings: string[] = [];

  for (const document of documents) {
    if (!document.vaultDocumentId) {
      warnings.push(
        document.filename
          ? `${document.filename} isn't in the document vault, so it wasn't read.`
          : "A document isn't in the document vault, so it wasn't read.",
      );
      continue;
    }

    try {
      const vaultDoc = await getCrmDocument(document.vaultDocumentId);
      const pathname = await resolveDocumentBlobPathname(vaultDoc);
      if (!pathname) {
        warnings.push(unreadable(document.filename));
        continue;
      }
      const buffer = await downloadImportFile(pathname);
      if (!buffer) {
        warnings.push(unreadable(document.filename));
        continue;
      }
      const uploadKind = detectUploadKind(buffer);
      if (uploadKind !== "pdf" && uploadKind !== "png" && uploadKind !== "jpeg") {
        warnings.push(unreadable(document.filename));
        continue;
      }
      // `readDocumentText` is the ONLY permitted route from bytes to text: it
      // SSN-redacts every page before returning. Never parse the buffer here.
      const { pages } = await readDocumentText({ buffer, uploadKind, model: "mini" });
      sources.push({
        documentId: document.id,
        role: document.role,
        filename: document.filename,
        text: pages.join("\n"),
      });
    } catch {
      warnings.push(unreadable(document.filename));
    }
  }

  return { sources, warnings };
}
