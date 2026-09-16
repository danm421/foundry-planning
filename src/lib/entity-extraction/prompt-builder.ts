// src/lib/entity-extraction/prompt-builder.ts
import { createHash } from "node:crypto";
import { askableFields } from "@/domain/forge/detail-fields";
import type { DetailEntity, DetailField } from "@/domain/forge/detail-fields";

function describeField(f: DetailField): string {
  const parts: string[] = [`- ${f.key} — ${f.label}`];
  if (f.required) parts.push("REQUIRED");
  parts.push(`type: ${f.kind}`);
  if (f.kind === "enum" && f.enumValues?.length) {
    parts.push(`one of exactly: ${f.enumValues.map((v) => `"${v}"`).join(", ")}`);
  }
  if (f.range) {
    const { min, max } = f.range;
    parts.push(`range: ${min ?? "-inf"}..${max ?? "+inf"}`);
  }
  if (f.aliases?.length) {
    parts.push(`also printed as: ${f.aliases.join(", ")}`);
  }
  if (f.notes) parts.push(f.notes);
  return parts.join(" | ");
}

/**
 * Turn a map entity into an extraction prompt. Pure: same entity, same prompt,
 * same hash. The hash goes in the extraction cache key so that editing the map
 * actually re-reads documents — without it, a map edit is invisible to anything
 * already extracted.
 */
export function buildEntityPrompt(entity: DetailEntity): { prompt: string; hash: string } {
  const fields = askableFields(entity);

  const prompt = [
    `You extract "${entity.label}" records from financial documents.`,
    "",
    "Return ONLY a JSON object with this exact structure (no markdown, no explanation):",
    "{",
    '  "rows": [',
    "    {",
    '      "<fieldKey>": { "value": <value>, "snippet": "<verbatim text you read it from>", "confidence": <0.0-1.0> }',
    "    }",
    "  ]",
    "}",
    "",
    "Fields. Use these exact keys. Omit a key entirely rather than guessing its value:",
    ...fields.map(describeField),
    "",
    "Rules:",
    '- "snippet" MUST be text copied verbatim from the document, character for character. It is checked against the document. If you cannot copy the exact text, omit the field.',
    '- "confidence" is your own 0.0-1.0 estimate that the value is correct.',
    '- A "rate" is a DECIMAL FRACTION: 3% is 0.03. A "percent" is a WHOLE NUMBER: 3% is 3. Read the field type above and use the right one. Getting these backwards is wrong by 100x.',
    '- A "money" value is a plain number: no currency symbol, no thousands separators.',
    '- A "date" is ISO YYYY-MM-DD. A "year" is a four-digit integer.',
    "- An enum value MUST be one of the listed tokens, copied exactly. Never a paraphrase, never the document's own wording, never title case.",
    "- Return one object in \"rows\" per distinct record in the document. Return an empty array if the document contains none.",
    "- Do not invent a value that is not in the document. Omitting a field is always correct when it is not printed.",
    "",
    "Output JSON only.",
  ].join("\n");

  const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
  return { prompt, hash };
}
