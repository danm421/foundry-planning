// Gates 5 and 6 — who the chapter is about, and whose words it uses.
//
// Both were written from the 2026-08-12 prose read, which found the model
// transcribing the fact pack's internal labels as English, describing the page
// it was writing, and drifting into third person about the reader. All three are
// deterministic and all three are two-sided: a rule that also rejects ordinary
// advisor prose spends the chapter's single retry on a note the model cannot
// act on, so every rule below is pinned in BOTH directions.
import { factLabelSet } from "../facts";
import type { GateFailure, Validator } from "./types";

/**
 * A label matches only as a WHOLE PHRASE. "Left at the end, current plan" is the
 * leak; "what's left at the end" is ordinary English that happens to share four
 * words with it, and rejecting that would make the gate unusable.
 *
 * Punctuation inside the label (the comma in "Left at the end, current plan") is
 * matched literally: the model copies the label, so it copies the comma.
 * Whitespace is the one thing loosened — a line break can fall anywhere inside a
 * phrase the model wrapped.
 */
function labelPattern(label: string): RegExp {
  const body = label
    .trim()
    .split(/\s+/u)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join(String.raw`\s+`);
  // Bounded on both sides so "the year you stop working" does not match inside a
  // longer coined phrase, and so a possessive or plural does not slip past.
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, "iu");
}

export const validateLabels: Validator = (markdown, facts) => {
  if (facts.length === 0) return [];
  const failures: GateFailure[] = [];
  // Deduplicated by label, not by match: two facts can share a label only by
  // mistake, and one message per leaked phrase is what the retry prompt needs.
  for (const label of factLabelSet(facts)) {
    if (!labelPattern(label).test(markdown)) continue;
    failures.push({
      gate: "labels",
      message:
        `You copied one of our internal column headings — "${label}" — into the chapter. ` +
        "Those are notes to you, not English. Say what the figure means in your own words.",
    });
  }
  return failures;
};
