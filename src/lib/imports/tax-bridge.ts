import { extractTaxReturnFacts } from "@/lib/tax-returns/extract-facts";
import { upsertExtracted } from "@/lib/tax-returns/store";
import type { UploadKind } from "@/lib/extraction/validate-upload";

/**
 * Route a document the import pipeline classified as a tax return into the
 * tax_returns store, so plan-basics derivation has real AGI / total tax to
 * read and the advisor gets a populated Tax Analysis tab.
 *
 * The generic import extractor returns the standard ExtractionResult shape,
 * which carries no tax block at all, and truncates long documents blindly.
 * The tax pipeline has a page-selection pass built for long returns, so it is
 * the right extractor for this document type.
 *
 * BEST EFFORT BY CONTRACT. This runs inside a file's extraction and must never
 * fail the import: a household whose 1040 will not parse should still get its
 * statements. Every failure degrades to a warning on the file result.
 */
export async function bridgeTaxReturn(args: {
  buffer: Buffer;
  filename: string;
  clientId: string;
  kind: UploadKind;
  model: "mini" | "full";
}): Promise<{ ok: boolean; warning?: string }> {
  try {
    const extracted = await extractTaxReturnFacts({
      buffer: args.buffer,
      fileName: args.filename,
      uploadKind: args.kind,
      model: args.model,
    });

    await upsertExtracted({
      clientId: args.clientId,
      taxYear: extracted.facts.taxYear,
      facts: extracted.facts,
      warnings: extracted.warnings,
      promptVersion: extracted.promptVersion,
      model: args.model,
      sourceFilename: args.filename,
      vaultDocumentId: null,
    });

    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    return {
      ok: false,
      warning: `Could not add this return to Tax analysis (${detail}). The document was still imported.`,
    };
  }
}
