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

type ReadOutcome =
  | { ok: true; source: DocumentSource }
  | { ok: false; warning: string };

/** Bounded by Azure OpenAI per-deployment TPM and downstream Neon/Blob request
 *  concurrency — same tuning rationale as `runImportExtraction`'s per-file
 *  concurrency cap. */
const CONCURRENCY = 5;

async function readOne(document: SourceDocument): Promise<ReadOutcome> {
  if (!document.vaultDocumentId) {
    return {
      ok: false,
      warning: document.filename
        ? `${document.filename} isn't in the document vault, so it wasn't read.`
        : "A document isn't in the document vault, so it wasn't read.",
    };
  }

  try {
    const vaultDoc = await getCrmDocument(document.vaultDocumentId);
    const pathname = await resolveDocumentBlobPathname(vaultDoc);
    if (!pathname) return { ok: false, warning: unreadable(document.filename) };

    const buffer = await downloadImportFile(pathname);
    if (!buffer) return { ok: false, warning: unreadable(document.filename) };

    const uploadKind = detectUploadKind(buffer);
    if (uploadKind !== "pdf" && uploadKind !== "png" && uploadKind !== "jpeg") {
      return { ok: false, warning: unreadable(document.filename) };
    }

    // `readDocumentText` is the ONLY permitted route from bytes to text: it
    // SSN-redacts every page before returning. Never parse the buffer here.
    const { pages } = await readDocumentText({ buffer, uploadKind, model: "mini" });
    return {
      ok: true,
      source: {
        documentId: document.id,
        role: document.role,
        filename: document.filename,
        text: pages.join("\n"),
      },
    };
  } catch (err) {
    console.error(`second read: could not read document ${document.id}`, err);
    return { ok: false, warning: unreadable(document.filename) };
  }
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
 *
 * Documents are independent of each other, so reads run in bounded-concurrency
 * chunks rather than one at a time — a scanned K-1 needing OCR no longer
 * serializes behind every other document in the packet. Processing chunk by
 * chunk (and `Promise.all` resolving in input order within a chunk) keeps
 * `sources`/`warnings` in the same document order the sequential version
 * produced.
 */
export async function loadDocumentSourceText(
  documents: SourceDocument[],
): Promise<SourceTextResult> {
  const sources: DocumentSource[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < documents.length; i += CONCURRENCY) {
    const chunk = documents.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(chunk.map(readOne));
    for (const outcome of outcomes) {
      if (outcome.ok) sources.push(outcome.source);
      else warnings.push(outcome.warning);
    }
  }

  return { sources, warnings };
}
