import { z } from "zod";
import { callAIExtraction } from "./azure-client";
import { parseAIResponse } from "./parse-response";
import { FACT_FINDER_CLASSIFIER_PROMPT } from "./prompts/fact-finder-classifier";

const pageRangeSchema = z
    .tuple([z.number().int().positive(), z.number().int().positive()])
    .refine(([start, end]) => end >= start, {
        message: "endPage must be >= startPage",
    });

export const ENTITY_SECTIONS = [
    "family",
    "accounts",
    "incomes",
    "expenses",
    "liabilities",
    "insurance",
    "wills",
    "entities",
] as const;

export type SectionEntityType = (typeof ENTITY_SECTIONS)[number];

const sectionsSchema = z.object({
    family: z.array(pageRangeSchema).max(3).default([]),
    accounts: z.array(pageRangeSchema).max(5).default([]),
    incomes: z.array(pageRangeSchema).max(3).default([]),
    expenses: z.array(pageRangeSchema).max(3).default([]),
    liabilities: z.array(pageRangeSchema).max(3).default([]),
    insurance: z.array(pageRangeSchema).max(3).default([]),
    wills: z.array(pageRangeSchema).max(2).default([]),
    entities: z.array(pageRangeSchema).max(2).default([]),
});

export type Sections = z.infer<typeof sectionsSchema>;

/**
 * Classify a fact-finder document into per-entity page ranges so the
 * multi-pass orchestrator can run focused per-section prompts. Returns
 * null on any failure (parse error, schema violation, AI error) so the
 * caller can fall back to single-pass extraction.
 */
export async function classifyFactFinder(
    outline: string,
    anchors: string
): Promise<Sections | null> {
    const userPrompt =
        "Document outline:\n" +
        "<outline>\n" +
        outline +
        "\n</outline>\n\n" +
        "Anchor pages (first three + last):\n" +
        "<anchors>\n" +
        anchors +
        "\n</anchors>";

    let raw: string;
    try {
        raw = await callAIExtraction(
            FACT_FINDER_CLASSIFIER_PROMPT,
            userPrompt,
            "full"
        );
    } catch (err) {
        console.warn(
            `[section-classifier] AI call failed: ${err instanceof Error ? err.message : "unknown"}`
        );
        return null;
    }

    const parsed = parseAIResponse(raw);
    // parseAIResponse returns {} on unparseable input; without at least one
    // recognized section key we treat the response as failed so callers can
    // fall back to single-pass instead of a vacuous all-empty classification.
    const hasAnyKnownKey = ENTITY_SECTIONS.some((k) =>
        Object.prototype.hasOwnProperty.call(parsed, k)
    );
    if (!hasAnyKnownKey) {
        console.warn(
            "[section-classifier] response had no recognized section keys"
        );
        return null;
    }

    const validation = sectionsSchema.safeParse(parsed);
    if (!validation.success) {
        console.warn(
            `[section-classifier] response failed schema: ${validation.error.issues[0]?.message ?? "unknown"}`
        );
        return null;
    }
    return validation.data;
}
