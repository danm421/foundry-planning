import { z } from "zod";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { parseAIResponse } from "@/lib/extraction/parse-response";
import {
  SUPPORTING_DOCUMENT_PROMPT,
  SUPPORTING_DOCUMENT_VERSION,
} from "@/lib/extraction/prompts/supporting-document";
import {
  emptyTaxReturnFacts,
  emptyK1,
  k1EntityTypeSchema,
  TAX_RETURN_MIN_YEAR,
  TAX_RETURN_MAX_YEAR,
  type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import { TaxReturnExtractionError } from "./errors";
import { supportingPayloadSchema, type SupportingPayload } from "./supporting-payload";

const MAX_INPUT_CHARS = 60_000;

const responseSchema = z.object({
  taxYear: z.number().int().nullable(),
  k1s: z
    .array(
      z.object({
        entityName: z.string().nullable().default(null),
        ein: z.string().nullable().default(null),
        entityType: k1EntityTypeSchema.nullable().default(null),
        ordinaryBusinessIncome: z.number().finite().nullable().default(null),
        rentalIncome: z.number().finite().nullable().default(null),
        guaranteedPayments: z.number().finite().nullable().default(null),
        section179: z.number().finite().nullable().default(null),
        qbiIncome: z.number().finite().nullable().default(null),
        isSstb: z.boolean().nullable().default(null),
      }),
      // NOT .strict(): the model volunteering an extra key (w2WagesFromEntity)
      // must be DROPPED, not turned into a parse failure that loses the K-1.
    )
    .default([]),
  w2s: z.array(z.object({
    employer: z.string().nullable().default(null),
    wages: z.number().finite().nullable().default(null),
  })).default([]),
});

export interface SupportingExtractionResult {
  taxYear: number;
  /** Null for `w2` and `other` — they contribute no facts at all (spec §2). */
  facts: TaxReturnFacts | null;
  payload: SupportingPayload | null;
  warnings: string[];
  promptVersion: string;
}

/**
 * The compact lane. A K-1 run through the full 1040 prompt spends its output
 * budget on ~120 null fields and is invited to synthesize 1040 lines from a
 * document that has none — which the merge would then have to defend against.
 * This prompt structurally cannot emit them.
 */
export async function extractSupportingDocument(args: {
  pages: string[];
  role: "k1" | "w2" | "other";
  model: "mini" | "full";
}): Promise<SupportingExtractionResult> {
  const warnings: string[] = [];
  let inputText = args.pages.join("\n");
  if (inputText.length > MAX_INPUT_CHARS) {
    inputText = inputText.slice(0, MAX_INPUT_CHARS);
    warnings.push("Very long document truncated for analysis — verify completeness of extracted figures.");
  }

  let raw: string;
  try {
    raw = await callAIExtraction(SUPPORTING_DOCUMENT_PROMPT, inputText, args.model);
  } catch (err) {
    throw new TaxReturnExtractionError(
      err instanceof Error ? err.message : "AI call failed",
      "The document couldn't be analyzed right now. Retry in a moment, or enter figures manually.",
    );
  }

  const parsed = responseSchema.safeParse(parseAIResponse(raw));
  if (!parsed.success) {
    throw new TaxReturnExtractionError(
      `unusable supporting extraction: ${raw.slice(0, 200)}`,
      "The document couldn't be read. Try a clearer copy, or enter figures manually in the review form.",
    );
  }

  const { taxYear } = parsed.data;
  if (
    taxYear == null ||
    taxYear < TAX_RETURN_MIN_YEAR ||
    taxYear > TAX_RETURN_MAX_YEAR
  ) {
    throw new TaxReturnExtractionError(
      `no usable tax year: ${taxYear}`,
      "Couldn't find a tax year on this document. Check it's the filed form and not a worksheet, or enter the figures manually.",
    );
  }

  let facts: TaxReturnFacts | null = null;
  if (args.role === "k1" && parsed.data.k1s.length > 0) {
    facts = emptyTaxReturnFacts(taxYear);
    facts.k1s = parsed.data.k1s.map((k) => ({
      ...emptyK1(),
      ...k,
      // `entityId` is minted by `mergeEntities` at MERGE time. A document's
      // extraction never carries one — two independent extractions of the same
      // K-1 could never agree on a minted id, which is why the union key is
      // derived from EIN/name instead.
      entityId: null,
      // Owner W-2 from this entity is an ADVISOR assignment (D10). The K-1 does
      // not state it, so a value here would be invented.
      w2WagesFromEntity: null,
    }));
  }

  const payload =
    args.role === "w2" && parsed.data.w2s.length > 0
      ? supportingPayloadSchema.parse({ w2s: parsed.data.w2s })
      : null;

  return {
    taxYear,
    facts,
    payload,
    warnings,
    promptVersion: `supporting_document:${SUPPORTING_DOCUMENT_VERSION}`,
  };
}
