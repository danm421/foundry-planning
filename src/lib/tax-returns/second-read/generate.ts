import { callAIExtraction } from "@/lib/extraction/azure-client";
import { parseAIResponse } from "@/lib/extraction/parse-response";
import { TAX_SECOND_READ_PROMPT } from "@/lib/extraction/prompts/tax-second-read";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { aiResponseSchema, MAX_SECOND_READ_ITEMS, type SecondRead } from "./types";
import { allocateCharBudget } from "./budget";
import type { DocumentSource } from "./source-text";

/** One call's worth of document text. Comfortably inside the 55s client
 *  timeout on the analysis model while still fitting a full 1040 packet plus
 *  its supporting forms. */
export const SECOND_READ_TOTAL_CHARS = 120_000;

const UNUSABLE_WARNING = "The second read didn't return anything usable this time.";

/** Lowercase, strip punctuation and collapse whitespace. Only used to
 *  recognise an item that restates a finding verbatim-ish; anything fuzzier
 *  would start silently dropping genuine items. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function buildSecondReadInput(args: {
  sources: DocumentSource[];
  facts: TaxReturnFacts;
  findingHeadlines: string[];
}): string {
  const budgets = allocateCharBudget(
    args.sources.map((s) => s.text.length),
    SECOND_READ_TOTAL_CHARS,
  );

  const documents = args.sources
    .map((s, i) => {
      const text = s.text.slice(0, budgets[i]);
      const truncated = text.length < s.text.length ? "\n[document truncated]" : "";
      return `--- DOCUMENT: ${s.filename ?? "untitled"} (role: ${s.role}) ---\n${text}${truncated}`;
    })
    .join("\n\n");

  const findings =
    args.findingHeadlines.length > 0
      ? args.findingHeadlines.map((h) => `- ${h}`).join("\n")
      : "(no findings fired for this return)";

  // `taxYear` is dropped from this summary, not withheld from the model — the
  // documents themselves print their own tax year, and this field is the only
  // reason the facts blob would need per-key surgery to stay legible.
  const { taxYear: _taxYear, ...factsForPrompt } = args.facts;
  void _taxYear;

  return [
    "=== DOCUMENTS ===",
    documents,
    "",
    "=== FIGURES CAPTURED SO FAR ===",
    JSON.stringify(factsForPrompt),
    "",
    "=== FINDINGS REPORTED SO FAR — do not repeat these ===",
    findings,
  ].join("\n");
}

/**
 * One AI call, then validate → drop restatements → cap → mint ids.
 *
 * The ordering matters: ids are minted LAST, over the surviving items, so the
 * panel never shows a gap where a dropped item used to be.
 *
 * A model response that fails to parse degrades to an empty read with a
 * warning rather than throwing — the advisor pressed a button and deserves an
 * answer. Only a failure of the CALL propagates, because that is retryable and
 * the route says so.
 */
export async function generateSecondRead(args: {
  sources: DocumentSource[];
  facts: TaxReturnFacts;
  findingHeadlines: string[];
  sourceWarnings: string[];
  generatedAt: string;
}): Promise<SecondRead> {
  // Nothing readable means nothing to read. Calling the model with an empty
  // document block invites it to answer from the facts summary alone, which is
  // exactly the deterministic layer's job.
  if (args.sources.length === 0) {
    return { generatedAt: args.generatedAt, warnings: args.sourceWarnings, items: [] };
  }

  const raw = await callAIExtraction(
    TAX_SECOND_READ_PROMPT,
    buildSecondReadInput(args),
    "full",
  );

  // `parseAIResponse` returns `{}` both when the model's text genuinely
  // parsed to an empty object AND when nothing resembling JSON could be
  // found at all. `aiResponseSchema`'s `items` field carries `.default([])`,
  // so zod alone can't tell those two cases apart — `{}` validates
  // successfully into `{ items: [] }` either way. Checking for the `items`
  // key on the pre-validation object is what actually distinguishes "the
  // model answered with junk" from "the model explicitly said {"items":[]}".
  const rawParsed = parseAIResponse(raw);
  const parsed = aiResponseSchema.safeParse(rawParsed);
  if (!parsed.success || !("items" in rawParsed)) {
    return {
      generatedAt: args.generatedAt,
      warnings: [...args.sourceWarnings, UNUSABLE_WARNING],
      items: [],
    };
  }

  const alreadyReported = new Set(args.findingHeadlines.map(normalize));
  const items = parsed.data.items
    .filter((item) => !alreadyReported.has(normalize(item.headline)))
    .slice(0, MAX_SECOND_READ_ITEMS)
    .map((item, i) => ({ ...item, id: `sr-${i + 1}`, dismissed: false }));

  return { generatedAt: args.generatedAt, warnings: args.sourceWarnings, items };
}
