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

/**
 * The chapter describing itself.
 *
 * Anchored on a DEMONSTRATIVE plus a document noun, which is what separates the
 * tell from ordinary use: "this change", "this year", "this account" are the
 * chapter doing its job, and only "this page" / "this chapter" / "this summary"
 * / "this report" / "this view" / "this section" / "this part of the plan" are
 * the chapter talking about itself.
 *
 * Note what is deliberately NOT here: a bare mention of "the pages that follow".
 * A `frontMatter` chapter is instructed to point forward, so a rule that
 * rejected forward references would reject the Executive brief's defining
 * behaviour.
 */
const DOC_NOUN = String.raw`(?:page|chapter|summary|report|section|view|overview|snapshot|write-?up)`;
const SELF_REFERENCE_RE = new RegExp(
  String.raw`\b(?:this|the)\s+(?:\w+[-\s]){0,2}${DOC_NOUN}\b` +
    String.raw`|\bthis\s+part\s+of\s+(?:the|your)\b`,
  "iu",
);

/**
 * …and the household described rather than addressed.
 *
 * Two shapes here, plus the names below:
 *
 *  1. `a household` / `the household` / `this household` as a noun — the reader
 *     turned into an anonymous third party on their own report. Requiring the
 *     DETERMINER is what makes `your household` pass untouched: the possessive
 *     takes the determiner's place, so the pattern cannot reach it. That is the
 *     whole two-sidedness of this rule — the bare noun would reject every
 *     sentence containing the word.
 *  2. `the client` / `the clients` — internal register.
 */
const THIRD_PERSON_NOUN_RE = /\b(?:a|an|the|this|that)\s+(?:household|client|couple|family)\b/iu;

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * A name used as anything but direct address.
 *
 * The prompt allows the names once, and the natural place is the vocative —
 * sentence-initial, followed by a comma ("Cooper and Susan, your plan holds
 * up"). Anywhere else — "For Cooper and Susan, that means…", "Cooper's plan
 * holds" — the advisor is talking ABOUT them to somebody who is not there, and
 * the sentence-boundary lookbehind is what tells the two apart.
 */
function thirdPersonName(text: string, names: string[]): string | null {
  for (const name of names) {
    const n = escapeName(name);
    // Every occurrence of the name as a whole word…
    const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${n}(?![\p{L}\p{N}])`, "giu");
    for (const match of text.matchAll(re)) {
      const before = text.slice(0, match.index);
      // …that is NOT preceded only by sentence start + other names/joiners.
      const runStart = /(?:^|[.!?]\s+|\n)\s*(?:[\p{Lu}][\p{L}'-]*(?:\s+and\s+|,\s*)?)*$/u.test(before);
      if (!runStart) return name;
      // A vocative closes with a comma. "Cooper and Susan, your plan…" is
      // address; "Cooper and Susan own $4.7M" is narration about them.
      const after = text.slice(match.index + match[0].length);
      if (!/^(?:\s+and\s+[\p{Lu}][\p{L}'-]*)?\s*,/u.test(after)) return name;
    }
  }
  return null;
}

/**
 * Gate 6, built over the household's own first names.
 *
 * A FACTORY rather than a `Validator`, because the four shipped gates fix that
 * signature at `(markdown, facts)` and the names are neither. `runGates` closes
 * over them once per chapter.
 */
export function registerGate(firstNames: string[]): Validator {
  return (markdown) => {
    const failures: GateFailure[] = [];

    const self = SELF_REFERENCE_RE.exec(markdown)?.[0];
    if (self) {
      failures.push({
        gate: "register",
        message:
          `"${self.trim()}" describes the document instead of their money. ` +
          "Never mention the page, the chapter or the report — write what the plan shows.",
      });
    }

    const noun = THIRD_PERSON_NOUN_RE.exec(markdown)?.[0];
    if (noun) {
      failures.push({
        gate: "register",
        message:
          `"${noun.trim()}" turns the reader into a third party on their own report. ` +
          'Write to them: "you", "your".',
      });
    }

    const name = thirdPersonName(markdown, firstNames);
    if (name) {
      failures.push({
        gate: "register",
        message:
          `You wrote about ${name} rather than to them. ` +
          'Use their first names only to address them directly, at the start of a sentence — otherwise say "you".',
      });
    }

    return failures;
  };
}
