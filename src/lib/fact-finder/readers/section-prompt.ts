// src/lib/fact-finder/readers/section-prompt.ts
import { createHash } from "node:crypto";
import type { RegionVocabularyEntry } from "@/lib/entity-extraction/region-classifier";
import { FACT_FINDER_SECTIONS, fixedLabelsOf, type ColumnKind, type FFColumn, type FFSection } from "../schema";

const KIND_RULE: Record<ColumnKind, string> = {
  text: "text, as printed",
  notes: "free text, as printed",
  money: "money: a plain number, no $ or commas (1250000.5)",
  number: "a plain number",
  percent: "a percent as a whole number: 6.5 means 6.5% (never 0.065)",
  integer: "a whole number",
  year: "a 4-digit year",
  date: "a date as YYYY-MM-DD",
  monthYear: "a month and year as YYYY-MM",
  choice: "one of the listed options",
  check: "true or false",
};

export function columnLine(column: FFColumn): string {
  const options = column.options?.length ? ` | one of exactly: ${column.options.map((o) => JSON.stringify(o)).join(", ")}` : "";
  return `- ${column.id} — ${column.label} | ${KIND_RULE[column.kind]}${options}`;
}

function rowRule(section: FFSection): string {
  if (section.layout === "fixedRows") {
    const labels = fixedLabelsOf(section).map((l) => JSON.stringify(l)).join(", ");
    return `Return at most one row per line, and give each row a "_row" key set to exactly one of: ${labels}.`;
  }
  if (section.layout === "notes") return "Return at most one row.";
  return "Return one row per item. Leave out items that are completely blank.";
}

/** The system prompt for reading one fact finder section, plus a short hash of it. */
export function buildSectionPrompt(section: FFSection): { prompt: string; hash: string } {
  const prompt = [
    `You read one section of a client's financial fact finder: "${section.label}".`,
    ...(section.hint ? [`About this section: ${section.hint}.`] : []),
    "",
    'Return ONLY a JSON object (no markdown) shaped like {"rows":[{"<column id>":{"value":<value>,"snippet":"<the exact words from the document>","confidence":<0 to 1>}}]}.',
    rowRule(section),
    "",
    "Columns:",
    ...section.columns.map(columnLine),
    "",
    "Rules:",
    "- Only use values printed in the document. Never guess, compute or fill in a value that isn't there; leave the column out instead.",
    "- snippet must be copied word for word from the document, so it can be found there.",
    "- confidence is how sure you are that the value belongs in this column (1 = certain).",
    "- For a column with options, use one of the options exactly as written above.",
    "- Leave out a column you can't fill, and a row with nothing in it.",
  ].join("\n");
  return { prompt, hash: createHash("sha256").update(prompt).digest("hex").slice(0, 12) };
}

/** Every section as a region-classifier vocabulary entry: its hint, then its column labels. */
export function sectionVocabulary(): RegionVocabularyEntry[] {
  return FACT_FINDER_SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    documentHints: [...(s.hint ? [s.hint] : []), `columns: ${s.columns.map((c) => c.label).join(", ")}`],
  }));
}
