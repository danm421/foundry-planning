// Gate 1 — the allowed-facts contract. Generalizes `dropUncitedActions`
// (src/lib/insights/generate.ts) from structured actions to free prose: there,
// the model may only recommend by citing a supplied signal id; here, it may
// only write a figure that appears in the supplied fact pack. An invented
// figure is not in the set, so it cannot survive.
//
// The gate is only as good as its extraction: a figure the regex cannot see is
// a figure the model can invent freely. So both halves below err toward
// matching MORE. A false positive costs one retry; a false negative puts a
// fabricated number in front of a client.
import { factDisplaySet, type Fact } from "../facts";
import type { GateFailure } from "./types";

/**
 * Fold the decoration and look-alike characters a model reaches for, so a
 * figure is judged on its digits rather than on how it was dressed up.
 * Emphasis *inside* a figure (`$**2.1M**`, `20**41**`) is the common case —
 * bolding key numbers is exactly what a report-writing model does.
 *
 * Applied to the prose AND to every fact `display`, so the two sides of the
 * set lookup can never drift apart.
 */
function normalizeFigures(text: string): string {
  return text
    .replace(/[*_]/gu, "") // markdown emphasis
    .replace(/[０-９]/gu, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[−‐‑]/gu, "-") // minus sign, hyphen, non-breaking hyphen
    .replace(/＄/gu, "$") // fullwidth dollar
    .replace(/[％﹪]/gu, "%") // fullwidth and small percent
    .replace(/[    ]/gu, " "); // NBSP and friends
}

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const MAG = String.raw`(?: ?(?:[MKB]|million|billion|thousand)\b)`;
const UNIT = String.raw`(?: ?(?:dollars?|USD)\b)`;
// A hyphen is a sign only where it cannot be a range: in "$2.1M-$3.4M",
// "73%-91%" and "2041-2045" it separates two figures, and reading it as a
// negative burns the single retry on prose that is entirely correct.
//
// The guard is scoped to the sign, not to the whole branch. Guarding the branch
// would also block a figure that merely *follows* a letter, so "US$2.1M" would
// lose its sigil and be reported as a truncated "2.1M" — the same phantom-quote
// defect the messages were fixed to avoid. With no sign there is nothing to
// disambiguate, so there is nothing to guard.
const SIGN = String.raw`(?:(?<![\w%])[-+])?`;

// Currency, percentage and year-shaped tokens, per the spec. Bare small
// integers are deliberately NOT matched: ages and counts are not plan outputs
// and the model needs them to write naturally. Everything money-shaped is —
// including the sigil-less forms, which are how a model evades a naive gate.
const FIGURE_RE = new RegExp(
  [
    String.raw`${SIGN}\$[-+]?(?:${NUM})${MAG}?${UNIT}?`, // $2.1M · $-2.1M · -$2.1M · $1,234 · $812
    String.raw`${SIGN}(?:${NUM}) ?%`, // 91% · 73.5% · 96 % · -12%
    String.raw`${SIGN}\d{1,3}(?:,\d{3})+(?:\.\d+)?${MAG}?${UNIT}?`, // 2,100,000 · 3,400,000 USD
    String.raw`${SIGN}\d{5,}(?:\.\d+)?${MAG}?${UNIT}?`, // 2100000 — the same evasion, without commas
    String.raw`${SIGN}(?:${NUM})${MAG}${UNIT}?`, // 3.4M · 3.4 million dollars
    String.raw`${SIGN}(?:${NUM})${UNIT}`, // 812 dollars
    String.raw`\b(?:19|20)\d{2}\b`, // 2041
  ].join("|"),
  "giu",
);

/**
 * Canonical comparison key. Case, spacing and sign placement are not part of a
 * figure's identity, so `$-2.1M`, `-$2.1M` and `$-2.1m` collapse to one key —
 * a model echoing a supplied negative must not be rejected. Everything else,
 * the `$` included, stays significant, so a bare `2.1M` never satisfies a fact
 * whose display is `$2.1M`.
 */
function figureKey(token: string): string {
  const bare = token.replace(/\s+/gu, "").toUpperCase();
  const negative = bare.startsWith("-") || bare.startsWith("$-");
  const magnitude = bare.replace(/^[-+]?\$?[-+]?/u, "");
  return `${negative ? "-" : ""}${bare.includes("$") ? "$" : ""}${magnitude}`;
}

export function extractFigures(markdown: string): string[] {
  return normalizeFigures(markdown).match(FIGURE_RE) ?? [];
}

export function validateFacts(markdown: string, facts: Fact[]): GateFailure[] {
  const allowed = new Set([...factDisplaySet(facts)].map((d) => figureKey(normalizeFigures(d))));
  const seen = new Set<string>();
  const failures: GateFailure[] = [];
  for (const figure of extractFigures(markdown)) {
    const key = figureKey(figure);
    if (allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    failures.push({
      gate: "facts",
      // Quote the figure as the model wrote it: this message is reused verbatim
      // in the retry prompt, so a truncated quote misdirects the fix.
      message: `The figure ${figure} is not one of the supplied plan figures. Use only the figures given, exactly as written.`,
    });
  }
  return failures;
}
