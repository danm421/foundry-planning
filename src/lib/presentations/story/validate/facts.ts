// Gate 1 — the allowed-facts contract. Generalizes `dropUncitedActions`
// (src/lib/insights/generate.ts) from structured actions to free prose: there,
// the model may only recommend by citing a supplied signal id; here, it may
// only write a figure that appears in the supplied fact pack. An invented
// figure is not in the set, so it cannot survive.
import { factDisplaySet, type Fact } from "../facts";
import type { GateFailure } from "./types";

// Dollars ($2.1M / $46K / $812 / $1,234), percentages (91% / 73.5%), and
// four-digit years (2041). Ages and small counts are deliberately NOT matched:
// they are not plan outputs and the model needs them to write naturally.
const FIGURE_RE = /\$\d[\d,]*(?:\.\d+)?[MK]?|\d+(?:\.\d+)?%|\b(?:19|20)\d{2}\b/g;

export function extractFigures(markdown: string): string[] {
  return markdown.match(FIGURE_RE) ?? [];
}

export function validateFacts(markdown: string, facts: Fact[]): GateFailure[] {
  const allowed = factDisplaySet(facts);
  const seen = new Set<string>();
  const failures: GateFailure[] = [];
  for (const figure of extractFigures(markdown)) {
    if (allowed.has(figure) || seen.has(figure)) continue;
    seen.add(figure);
    failures.push({
      gate: "facts",
      message: `The figure ${figure} is not one of the supplied plan figures. Use only the figures given, exactly as written.`,
    });
  }
  return failures;
}
