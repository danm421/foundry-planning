import type { UploadKind } from "@/lib/extraction/validate-upload";
import { readDocumentText } from "./document-text";
import { classifyDocumentRole } from "./classify-role";
import { extractTaxReturnFacts } from "./extract-facts";
import { extractSupportingDocument } from "./extract-supporting";
import { initState, insertDocument, deleteDocument } from "./documents-store";
import { recomputeFacts } from "./recompute";
import type { DocumentRole } from "./merge/types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import type { SupportingPayload } from "./supporting-payload";

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
 *
 * Preconditions this function does NOT check: the caller owns
 * `requireClientEditAccess` + `recordAudit` (this function has no `clientId`
 * to check against — `getTaxReturn` is keyed by client+year, so it
 * structurally cannot be consumed here; authz belongs to the route that
 * resolves `taxReturnId` from the year). The caller must also ensure
 * `args.taxYear` is the `taxYear` of the row identified by `args.taxReturnId`.
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
  // Skip the initial read entirely when the advisor already named
  // `full_return`: the 1040 lane re-reads the buffer itself below (it owns
  // the page-selection pass for long returns), so reading here would just be
  // a discarded OCR pass on any scanned full return — paid for and thrown
  // away, doubling latency and doubling exposure to OCR failure. The `auto`
  // path that later CLASSIFIES as `full_return` still double-reads; that is
  // the plan's accepted cost, because the classifier genuinely needs pages.
  let pages: string[] = [];
  let readWarnings: string[] = [];
  if (args.role !== "full_return") {
    const read = await readDocumentText({
      buffer: args.buffer,
      uploadKind: args.uploadKind,
      model: args.model,
    });
    pages = read.pages;
    readWarnings = read.warnings;
  }

  const role = args.role === "auto" ? await classifyDocumentRole(pages) : args.role;

  let documentYear: number;
  let extractedFacts: TaxReturnFacts | null;
  let supportingPayload: SupportingPayload | null = null;
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

  // The 1040 lane's `extraction.warnings` already includes its own internal
  // read's warnings (`extractTaxReturnFacts` calls `readDocumentText` itself),
  // so prefixing our `readWarnings` here would store every read warning
  // twice, permanently, on every scanned full-return upload. The supporting
  // lane never re-reads, so its warnings still need the prefix.
  const warnings =
    role === "full_return" ? extractWarnings : [...readWarnings, ...extractWarnings];

  const row = await insertDocument({
    taxReturnId: args.taxReturnId,
    role,
    filename: args.filename,
    vaultDocumentId: args.vaultDocumentId,
    extractedFacts,
    supportingPayload,
    warnings,
    promptVersion,
    model: args.model,
    taxYear: documentYear,
  });

  try {
    await recomputeFacts(args.taxReturnId, args.taxYear);
  } catch (err) {
    // A partially-completed add must not leave a document row whose figures
    // are not reflected in `tax_returns.facts` — that silent inconsistency is
    // exactly what this pipeline's refuse-rather-than-corrupt posture (D9,
    // Task 7's `EmptyRecomputeError`) exists to prevent. Compensate by
    // deleting the row we just inserted, then rethrow the ORIGINAL error — a
    // failure in the cleanup delete must not mask it.
    try {
      await deleteDocument(args.taxReturnId, row.id);
    } catch {
      // swallow — the original recompute error is what the caller needs to see
    }
    throw err;
  }

  return { documentId: row.id, role, warnings: row.warnings };
}
