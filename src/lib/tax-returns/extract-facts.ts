import { z } from "zod";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { buildPageOutline } from "@/lib/extraction/page-outline";
import { parseAIResponse } from "@/lib/extraction/parse-response";
import type { UploadKind } from "@/lib/extraction/validate-upload";
import {
  TAX_RETURN_FACTS_PROMPT,
  TAX_RETURN_FACTS_VERSION,
} from "@/lib/extraction/prompts/tax-return-facts";
import { TAX_FORM_CLASSIFIER_PROMPT } from "@/lib/extraction/prompts/tax-form-classifier";
import { parseTaxReturnFactsJson, TaxReturnParseError } from "./parse-facts";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { TaxReturnExtractionError } from "./errors";
import { readDocumentText } from "./document-text";
export { TaxReturnExtractionError } from "./errors";

const SINGLE_PASS_MAX_PAGES = 15;
const MAX_SELECTED_PAGES = 40;
const MAX_INPUT_CHARS = 150_000;

export interface ExtractFactsResult {
  facts: TaxReturnFacts;
  isAmended: boolean;
  warnings: string[];
  promptVersion: string;
}

const rangesSchema = z.object({
  relevantPages: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).max(30),
});

/**
 * Classify which pages of a long return are worth sending to the facts
 * extractor. Runs on the cheap "mini" model regardless of the caller's
 * requested model — classification doesn't need the stronger model, and
 * keeping it fixed bounds the cost of long returns.
 *
 * Any failure (AI error, non-JSON response, empty selection) degrades to
 * the leading pages of the document rather than failing the whole
 * extraction — a long return is still more likely to have its 1040 near
 * the front than not.
 */
async function selectPages(pages: string[], warnings: string[]): Promise<number[]> {
  const outline = buildPageOutline(pages);
  const anchors = pages.slice(0, 2).join("\n").slice(0, 4000);
  try {
    const raw = await callAIExtraction(
      TAX_FORM_CLASSIFIER_PROMPT,
      `OUTLINE:\n${outline}\n\nANCHORS:\n${anchors}`,
      "mini",
    );
    const parsed = rangesSchema.parse(parseAIResponse(raw));
    const selected = new Set<number>();
    for (const [start, end] of parsed.relevantPages) {
      for (let p = start; p <= Math.min(end, pages.length); p++) selected.add(p);
    }
    if (selected.size === 0) throw new Error("empty selection");
    return [...selected].sort((a, b) => a - b).slice(0, MAX_SELECTED_PAGES);
  } catch {
    warnings.push(
      "Automatic page selection failed — analyzed the leading pages of the document only.",
    );
    return pages.slice(0, 20).map((_, i) => i + 1);
  }
}

/**
 * Extract structured 1040 facts from an uploaded tax return.
 *
 * Deliberate deviation from spec §2: long returns get ONE classifier call
 * to pick relevant pages followed by ONE extraction call over just those
 * pages, rather than parallel per-form extraction calls with a merge step.
 */
export async function extractTaxReturnFacts(args: {
  buffer: Buffer;
  fileName: string;
  uploadKind: UploadKind;
  model: "mini" | "full";
}): Promise<ExtractFactsResult> {
  const { pages, warnings: readWarnings } = await readDocumentText({
    buffer: args.buffer,
    uploadKind: args.uploadKind,
    model: args.model,
  });
  const warnings: string[] = [...readWarnings];

  let inputText: string;
  if (pages.length <= SINGLE_PASS_MAX_PAGES) {
    inputText = pages.join("\n");
  } else {
    const selected = await selectPages(pages, warnings);
    inputText = selected.map((p) => pages[p - 1]).join("\n");
  }
  if (inputText.length > MAX_INPUT_CHARS) {
    inputText = inputText.slice(0, MAX_INPUT_CHARS);
    warnings.push("Very long document truncated for analysis — verify completeness of extracted figures.");
  }

  let raw: string;
  try {
    raw = await callAIExtraction(TAX_RETURN_FACTS_PROMPT, inputText, args.model);
  } catch (err) {
    throw new TaxReturnExtractionError(
      err instanceof Error ? err.message : "AI call failed",
      "The document couldn't be analyzed right now. Retry in a moment, or enter figures manually.",
    );
  }

  let parsed;
  try {
    parsed = parseTaxReturnFactsJson(raw);
  } catch (err) {
    if (err instanceof TaxReturnParseError) {
      throw new TaxReturnExtractionError(err.message, err.message);
    }
    // Unknown throw: keep the internal message for logs, but never leak it
    // to the user — every failure from this orchestrator carries a
    // user-safe userMessage.
    throw new TaxReturnExtractionError(
      err instanceof Error ? err.message : "unexpected parse failure",
      "The document couldn't be analyzed right now. Retry in a moment, or enter figures manually.",
    );
  }
  if (parsed.isAmended) {
    throw new TaxReturnExtractionError(
      "amended return",
      "This looks like an amended return (Form 1040-X), which isn't supported yet. Upload the original filed return.",
    );
  }

  return {
    facts: parsed.facts,
    isAmended: false,
    warnings: [...warnings, ...parsed.warnings],
    promptVersion: `tax_return_facts:${TAX_RETURN_FACTS_VERSION}`,
  };
}
