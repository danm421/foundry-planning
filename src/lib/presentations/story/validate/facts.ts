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

// A figure spelled in words. Every branch above needs a digit, so a model told
// to write "the way you would talk to them across a table" evades all of them
// simply by writing the number out — "about two and a half million" is what that
// register reaches for, and it reads to a client as a hard figure.
//
// A number word alone is NOT a figure: ages, counts and durations ("you turn
// sixty two", "three changes", "ten years") are not plan outputs, and the model
// needs them to write naturally. The money or percent noun is what separates the
// two, so it is required rather than optional.
const WORD_UNIT = String.raw`(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)`;
/** How the words of one figure are joined: plain space, hyphen, or the two
 *  words that carry a decimal and a remainder ("three point four", "one hundred
 *  and twenty"). */
const WORD_JOIN = String.raw`(?:[\s-]+(?:point|and)[\s-]+|[\s-]+)`;
const WORD_NUM = String.raw`${WORD_UNIT}(?:${WORD_JOIN}${WORD_UNIT})*`;
const WORD_NOUN = String.raw`(?:dollars?|USD|percent|per\s+cent)`;

// Currency, percentage and year-shaped tokens, per the spec. Bare small
// integers are deliberately NOT matched: ages and counts are not plan outputs
// and the model needs them to write naturally. Everything money-shaped is —
// including the sigil-less forms, which are how a model evades a naive gate.
//
// ORDER IS LOAD-BEARING where two branches can match at the same position, and
// the year branch is the one to be careful with. It must sit BELOW the magnitude
// and unit branches and ABOVE the bare-integer one:
//
//   above `\d{4,}`   so a year is still quoted as a year, now that the
//                    bare-integer floor is four digits rather than five;
//   below the money  so "2041 dollars" is read as a dollar amount rather than as
//   branches         a year with a stray noun after it. Both `plan.retirementYear`
//                    and `plan.endOfLifeYear` are in EVERY pack, so a year branch
//                    that ran first would let a supplied year ground an invented
//                    amount beside it — the exact class of miss this module
//                    exists to close. Pinned by the ordering test in the suite.
const FIGURE_RE = new RegExp(
  [
    String.raw`${SIGN}\$[-+]?(?:${NUM})${MAG}?${UNIT}?`, // $2.1M · $-2.1M · -$2.1M · $1,234 · $812
    String.raw`${SIGN}(?:${NUM}) ?%`, // 91% · 73.5% · 96 % · -12%
    String.raw`${SIGN}\d{1,3}(?:,\d{3})+(?:\.\d+)?${MAG}?${UNIT}?`, // 2,100,000 · 3,400,000 USD
    String.raw`${SIGN}(?:${NUM})${MAG}${UNIT}?`, // 3.4M · 3.4 million dollars
    String.raw`${SIGN}(?:${NUM})${UNIT}`, // 812 dollars · 2041 dollars
    String.raw`\b(?:19|20)\d{2}\b`, // 2041
    // 3400 · 2100000 — the same evasion, without commas. Four digits rather than
    // five: "3400" reads to a client as a hard figure, and every four-digit
    // number that is NOT a year was invisible to the branch above.
    String.raw`${SIGN}\d{4,}(?:\.\d+)?${MAG}?${UNIT}?`,
    String.raw`\b${WORD_NUM}[\s-]+${WORD_NOUN}\b`, // three point four million dollars · ninety six percent
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

/**
 * Does `markdown` name this exact figure?
 *
 * Exported so Gate 8 can ask the question without a second copy of the
 * extraction or of `figureKey`. Both stay private: a gate that normalised
 * figures its own way would accept a spelling Gate 1 rejects, which is how one
 * gate starts licensing what another forbids.
 */
export function citesFigure(markdown: string, display: string): boolean {
  const want = figureKey(normalizeFigures(display));
  return extractFigures(markdown).some((f) => figureKey(f) === want);
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
