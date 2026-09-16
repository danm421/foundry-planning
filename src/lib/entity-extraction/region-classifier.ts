// src/lib/entity-extraction/region-classifier.ts
import { z } from "zod";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { parseAIResponse } from "@/lib/extraction/parse-response";
import type { DetailEntity } from "@/domain/forge/detail-fields";

export type DocumentRegions = Record<string, Array<[number, number]>>;

/**
 * Per-entity cap, mirroring `section-classifier.ts`. Bounds the output so a
 * runaway response cannot dispatch thousands of per-region extraction calls.
 */
const MAX_RANGES_PER_ENTITY = 20;

const pageRangeSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([start, end]) => end >= start, { message: "endPage must be >= startPage" });

function schemaFor(entities: DetailEntity[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const entity of entities) {
    shape[entity.id] = z.array(pageRangeSchema).max(MAX_RANGES_PER_ENTITY).default([]);
  }
  // Unknown keys are stripped rather than rejected: a model naming an entity
  // outside the vocabulary is a nuisance, not a reason to lose the whole read.
  return z.object(shape);
}

export function buildRegionClassifierPrompt(entities: DetailEntity[]): string {
  return [
    "You segment financial documents into per-entity page ranges so that focused extractors can run on each slice.",
    "",
    "You will be given an outline of the document and anchor pages.",
    "",
    "Return ONLY a JSON object (no markdown, no explanation) whose keys are the entity ids below and whose values are arrays of [startPage, endPage] pairs:",
    ...entities.map((e) => {
      const hints = e.documentHints?.length ? ` — looks like: ${e.documentHints.join("; ")}` : "";
      return `- "${e.id}" — ${e.label}${hints}`;
    }),
    "",
    "Rules:",
    "- Page numbers are 1-indexed and inclusive on both ends.",
    "- Use an empty array for an entity the document does not contain.",
    "- Ranges must be tight. Exclude cover pages, instructions and signature pages.",
    "- Do NOT overlap ranges within one entity. Non-contiguous sections are separate ranges.",
    "- A page may belong to more than one entity. Include it under every entity it carries data for.",
    "- Use ONLY the entity ids listed above. Never invent a key.",
    "",
    "Output JSON only.",
  ].join("\n");
}

/**
 * Ask which entities appear on which pages. Returns null on any failure — a
 * thrown AI call, an unparseable or non-object response, a schema violation,
 * or a response naming none of the offered entities — so the caller falls
 * back rather than treating a vacuous all-empty classification as a real
 * answer.
 */
export async function classifyRegions(args: {
  outline: string;
  anchors: string;
  entities: DetailEntity[];
}): Promise<DocumentRegions | null> {
  const { outline, anchors, entities } = args;
  if (entities.length === 0) return null;

  const userPrompt =
    "Document outline:\n<outline>\n" + outline + "\n</outline>\n\n" +
    "Anchor pages (first three + last):\n<anchors>\n" + anchors + "\n</anchors>";

  let raw: string;
  try {
    raw = await callAIExtraction(buildRegionClassifierPrompt(entities), userPrompt, "full");
  } catch (err) {
    console.warn(`[region-classifier] AI call failed: ${err instanceof Error ? err.message : "unknown"}`);
    return null;
  }

  // parseAIResponse is typed as returning Record<string, unknown>, but its
  // first branch is a bare JSON.parse: a reply of the literal token "null"
  // (or a top-level array/number/string) is valid JSON and comes back as
  // that value, not `{}`. Treat that as unknown until it is checked below —
  // Object.hasOwnProperty.call throws on a null/undefined receiver, and that
  // throw must not escape as an unhandled rejection past this function's
  // documented "null on any parse failure" contract.
  const parsed: unknown = parseAIResponse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn("[region-classifier] response was not a JSON object");
    return null;
  }

  const hasAnyKnownKey = entities.some((e) =>
    Object.prototype.hasOwnProperty.call(parsed, e.id),
  );
  if (!hasAnyKnownKey) {
    console.warn("[region-classifier] response named none of the offered entities");
    return null;
  }

  const validation = schemaFor(entities).safeParse(parsed);
  if (!validation.success) {
    console.warn(`[region-classifier] response failed schema: ${validation.error.issues[0]?.message ?? "unknown"}`);
    return null;
  }
  return validation.data as DocumentRegions;
}
