import type { UploadKind } from "@/lib/extraction/validate-upload";
import { readDocumentText } from "./document-text";
import { classifyDocumentRole } from "./classify-role";
import { extractTaxReturnFacts } from "./extract-facts";
import { extractSupportingDocument } from "./extract-supporting";
import { initState, insertDocument } from "./documents-store";
import { recomputeFacts } from "./recompute";
import type { DocumentRole } from "./merge/types";

/**
 * D9: the tax year is a HARD GATE, not a merge field. The document's own
 * extracted year decides which return it belongs to; a mismatch is surfaced to
 * the advisor rather than reconciled. Merging a 2023 K-1 into 2024 would
 * corrupt both years silently, and no downstream code could detect it.
 */
export class TaxYearMismatchError extends Error {
  readonly userMessage: string;
  constructor(readonly documentYear: number, readonly targetYear: number) {
    super(`document year ${documentYear} != target ${targetYear}`);
    this.name = "TaxYearMismatchError";
    this.userMessage = `This document is for tax year ${documentYear}, but you're adding it to ${targetYear}. Open the ${documentYear} year and add it there.`;
  }
}

/**
 * The single lib function owning an add: read text → classify (or take the
 * advisor's named role) → extract down one of two lanes → year gate →
 * `initState` → `insertDocument` → `recomputeFacts`. Lives in `lib/` rather
 * than a route so it is testable without HTTP and so a shared route helper
 * is never exported from a `route.ts`.
 */
export async function addDocumentToReturn(args: {
  taxReturnId: string;
  taxYear: number;
  buffer: Buffer;
  filename: string;
  uploadKind: UploadKind;
  model: "mini" | "full";
  role: DocumentRole | "auto";
  vaultDocumentId: string | null;
}): Promise<{ documentId: string; role: DocumentRole; warnings: string[] }> {
  const { pages, warnings: readWarnings } = await readDocumentText({
    buffer: args.buffer,
    uploadKind: args.uploadKind,
    model: args.model,
  });

  const role = args.role === "auto" ? await classifyDocumentRole(pages) : args.role;

  let documentYear: number;
  let extractedFacts: unknown = null;
  let supportingPayload: unknown = null;
  let extractWarnings: string[];
  let promptVersion: string;

  if (role === "full_return") {
    const extraction = await extractTaxReturnFacts({
      buffer: args.buffer,
      fileName: args.filename,
      uploadKind: args.uploadKind,
      model: args.model,
    });
    documentYear = extraction.facts.taxYear;
    extractedFacts = extraction.facts;
    extractWarnings = extraction.warnings;
    promptVersion = extraction.promptVersion;
  } else {
    const extraction = await extractSupportingDocument({ pages, role, model: args.model });
    documentYear = extraction.taxYear;
    extractedFacts = extraction.facts;
    supportingPayload = extraction.payload;
    extractWarnings = extraction.warnings;
    promptVersion = extraction.promptVersion;
  }

  if (documentYear !== args.taxYear) {
    throw new TaxYearMismatchError(documentYear, args.taxYear);
  }

  // BEFORE the insert, not after. `recomputeFacts` refuses on a missing state
  // row, and a document inserted without one would be unreachable — every
  // recompute would throw until someone noticed.
  await initState(args.taxReturnId);

  const row = await insertDocument({
    taxReturnId: args.taxReturnId,
    role,
    filename: args.filename,
    vaultDocumentId: args.vaultDocumentId,
    extractedFacts,
    supportingPayload,
    warnings: [...readWarnings, ...extractWarnings],
    promptVersion,
    model: args.model,
    taxYear: documentYear,
  });

  await recomputeFacts(args.taxReturnId, args.taxYear);

  return { documentId: row.id, role, warnings: row.warnings };
}
