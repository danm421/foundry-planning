// Gate 4 — does this read like the advisor wrote it, or like a language model
// did? Three deterministic checks. None guarantees the ceiling; together they
// raise the floor enough that the advisor's edit in the review panel is small.
//
// Like Gates 1-3, this one is a TWO-SIDED constraint. A tell the gate cannot see
// is a machine-written page handed to a client; a rejection of ordinary advisor
// prose burns the chapter's single retry on a note the model cannot act on. Both
// directions are pinned in the suite, and every rule below was measured against
// both before it was kept.
import type { GateFailure, Validator } from "./types";
import { splitSentences } from "./readability";

/**
 * Phrases that mark text as machine-written to any reader who has seen a
 * chatbot. Matched case-insensitively, as whole words, against the NORMALIZED
 * document (see `normalize`) — a model writes `It’s important to note` with a
 * curly apostrophe and `It's **important to note**` with emphasis, and a plain
 * substring test sees neither.
 */
export const AI_TELLS = [
  "it's important to note",
  "it is important to note",
  "it's worth noting",
  "it is worth noting",
  "in summary",
  "in conclusion",
  "overall",
  "here's a breakdown",
  "here is a breakdown",
  "delve",
  "landscape",
  "robust",
  "a testament to",
  "navigating the",
  "when it comes to",
] as const;

/**
 * Two tells are not the phrase they are written as, and a literal match on the
 * phrase is wrong in opposite directions. Keyed by the `AI_TELLS` entry so a
 * phrase cannot be edited in one place and left stale in the other.
 */
const TELL_OVERRIDES: Partial<Record<(typeof AI_TELLS)[number], RegExp>> = {
  // The stem is not a word: a model writes "delving into the numbers".
  delve: /\bdelv(?:e|es|ed|ing)\b/iu,
  // ...and the reverse. Bare "overall" is ordinary financial English — "your
  // overall confidence", "the overall picture". Only the discourse marker that
  // OPENS a sentence, a line, or a bullet is the tell, with or without the
  // comma the plan's list assumed.
  overall: /(?:^|[.!?]\s+)[\s>#+-]*overall\b/imu,
};

/** Curly apostrophes and quotes, which is how a model actually punctuates. */
const CURLY_APOSTROPHE_RE = /[‘’‛ʼ]/gu;
const CURLY_QUOTE_RE = /[“”]/gu;
/** Markdown emphasis and code ticks are decoration, not spelling. Same call
 *  Gate 2 makes: `It's **important to note**` is the tell, written in bold. */
const EMPHASIS_RE = /[*_`]/gu;
/** Zero-width characters, which survive a copy-paste and hide a phrase. */
const INVISIBLE_RE = /[\u200B-\u200D\uFEFF]/gu;
/** Every space that is not U+0020 — a non-breaking space inside a tell is a
 *  one-character evasion of a phrase match. */
const ODD_SPACE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;

/**
 * The single form every check below reads. Line breaks are deliberately KEPT:
 * the rhythm check counts one line as one unit, and the "overall" tell is
 * anchored to the start of a line.
 */
function normalize(markdown: string): string {
  return markdown
    .replace(CURLY_APOSTROPHE_RE, "'")
    .replace(CURLY_QUOTE_RE, '"')
    .replace(INVISIBLE_RE, "")
    .replace(ODD_SPACE_RE, " ")
    .replace(EMPHASIS_RE, "");
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** Words joined by `\s+`, so a line break or a doubled space inside a phrase
 *  does not hide it. Word-bounded, so "overallocated" is not "overall". */
function tellPattern(phrase: (typeof AI_TELLS)[number]): RegExp {
  const override = TELL_OVERRIDES[phrase];
  if (override) return override;
  const body = phrase.split(" ").map(escapeRegExp).join(String.raw`\s+`);
  return new RegExp(String.raw`\b${body}\b`, "iu");
}

const TELLS: readonly RegExp[] = AI_TELLS.map(tellPattern);

/**
 * A stacked hedge — "may potentially", "could possibly" — says less than either
 * word alone and is the register a model reaches for when it will not commit.
 * One hedge is ordinary ("the plan may not last"); two in a row is the tell.
 */
const HEDGE_STACK_RE =
  /\b(?:may|might|could|can|would)\s+(?:not\s+|also\s+)?(?:potentially|possibly|perhaps|conceivably|presumably|arguably|seemingly|likely|typically|generally|probably)\b/iu;

/**
 * "clearer, simpler, and more effective" — the most reliable tell in financial
 * prose. Three comma-separated items closed by "and"/"or".
 *
 * A word may carry a sigil or a bracket ("$40K", "401(k)") but must START with a
 * letter or a digit, so a bullet's own "-" cannot stand in as an item. Only the
 * MIDDLE item may run to three words: the first item's head is the word before
 * the comma, and anything earlier belongs to whatever governs the list — which
 * is exactly what `firstTriad` looks back at.
 */
const ITEM_WORD = String.raw`[\p{L}\p{N}][\p{L}\p{N}$%().'-]*`;
/** Horizontal space only. A line break may follow a comma, but an item may not
 *  straddle two lines — that is how two bullets weld into a phantom triad. */
const H_SPACE = String.raw`[^\S\r\n]+`;
const TRIAD_RE = new RegExp(
  `(${ITEM_WORD}),\\s+(${ITEM_WORD}(?:${H_SPACE}${ITEM_WORD}){0,2}),?\\s+(?:and|or)\\s+(${ITEM_WORD})`,
  "giu",
);

/** A list that is the object of one of these ENUMERATES what the client owns —
 *  "your money sits in cash, bonds, and stocks". The rhetorical triad the spec
 *  names sits in predicate position instead ("the plan IS clearer, simpler…"). */
const ENUMERATING_PREP_RE =
  /^(?:in|into|on|onto|at|to|from|of|for|with|without|between|among|amongst|across|through|by|over|under|within|toward|towards|about|around|during|beyond|via|than|including|besides)$/iu;
/** A figure in an item means the list names years or amounts, not qualities. */
const FIGURE_IN_ITEM_RE = /[\p{N}$%]/u;
/** …and a capital past the opening word means it names people or accounts:
 *  "Anna, Ben, and Chloe", "your Roth, your IRA, and your brokerage". Only the
 *  first item is exempt, because there a capital may just be the sentence's. */
const CAPITALISED_RE = /(?:^|[^\p{L}])\p{Lu}/u;
const WORD_BEFORE_RE = /([\p{L}\p{N}'-]+)[^\p{L}\p{N}]*$/u;

/** The rhetorical triad, or null when the list is an ordinary enumeration. */
function firstTriad(text: string): string | null {
  for (const match of text.matchAll(TRIAD_RE)) {
    const [whole, first, middle, last] = match;
    if ([first, middle, last].some((item) => FIGURE_IN_ITEM_RE.test(item))) continue;
    if ([middle, last].some((item) => CAPITALISED_RE.test(item))) continue;
    const before = WORD_BEFORE_RE.exec(text.slice(0, match.index))?.[1] ?? "";
    if (ENUMERATING_PREP_RE.test(before)) continue;
    return whole.trim();
  }
  return null;
}

/** Markdown allows up to three spaces of indent before the hashes. */
const HEADING_LINE_RE = /^ {0,3}#{1,6}\s/u;
/** A bullet, a quote marker, or an ordered-list number is not a word, and
 *  counting it as one inflates every short line by exactly one. */
const LEADING_MARKER_RE = /^\s*(?:[>+•-]\s+|\d+[.)]\s+)/u;

/**
 * The unit the rhythm is measured in. A chapter is markdown, so a line break
 * ends a unit as surely as a full stop does — Gate 2 reached the same
 * conclusion. Two consequences, both load-bearing:
 *
 *   · a chapter of bullets is measurable at all (whole-document splitting makes
 *     it ONE unit, and one unit is never metronomic), and
 *   · a HEADING is dropped rather than welded to the sentence under it. A
 *     heading is a label, not a sentence, and counting its two or three words
 *     as a unit hands the model a one-line evasion: prepend "## Your plan" and
 *     four identical sentences acquire all the variance they need.
 */
function unitLengths(markdown: string): number[] {
  return normalize(markdown)
    .split(/\r?\n/u)
    .filter((line) => !HEADING_LINE_RE.test(line))
    .map((line) => line.replace(LEADING_MARKER_RE, ""))
    .flatMap(splitSentences)
    .map((unit) => unit.split(/\s+/u).filter(Boolean).length);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(lengths: number[]): number {
  const centre = mean(lengths);
  return Math.sqrt(mean(lengths.map((n) => (n - centre) ** 2)));
}

export function sentenceLengthStdDev(text: string): number {
  const lengths = unitLengths(text);
  if (lengths.length < 2) return Number.POSITIVE_INFINITY;
  return stdDev(lengths);
}

/**
 * The rhythm is judged on the spread RELATIVE to the average sentence, not on
 * the standard deviation itself. A bare standard deviation is a length, so its
 * threshold means opposite things at opposite scales: "You are fine. The money
 * lasts through both your lifetimes. Nothing to fix." runs from three words to
 * seven and scores 1.9, while four sentences that never stray more than a word
 * or two either side of twenty score 1.1. Any absolute cutoff that catches the
 * second rejects the first.
 *
 * The number is measured, not chosen: across the suite's two corpora the
 * highest rejected text scores 0.111 and the lowest accepted one 0.141, and
 * both are pinned as tests. Moving it either way breaks one of them.
 */
const MIN_RELATIVE_SPREAD = 0.125;
/**
 * Two sentences of equal length is a coincidence — "The plan may not last if
 * you spend at last year's pace. We modelled that, and the gap shows up in your
 * late seventies." is thirteen words twice, and there is nothing to tell the
 * model to fix. Three is the shortest run that can show a rhythm.
 */
const MIN_UNITS_FOR_RHYTHM = 3;

/** Typed as `Validator` like Gates 2 and 3, so the gate runner's two-argument
 *  call stays type-checked while the unused fact pack stays unnamed — this
 *  repo's lint has no ignore pattern for a leading underscore. */
export const validateVoice: Validator = (markdown) => {
  const failures: GateFailure[] = [];
  const text = normalize(markdown);

  // Quote what the DOCUMENT says, not the list entry that found it: the message
  // is reused verbatim in the retry prompt, and "it's important to note" is not
  // a string the model can search its own draft for.
  for (const pattern of TELLS) {
    const found = pattern.exec(text)?.[0].trim();
    if (!found) continue;
    failures.push({
      gate: "voice",
      message: `"${found}" reads as machine-written. Say it the way you would to the client's face.`,
    });
  }

  const hedges = HEDGE_STACK_RE.exec(text)?.[0];
  if (hedges) {
    failures.push({
      gate: "voice",
      message: `"${hedges}" stacks two hedges. Say how likely it is, or say it plainly.`,
    });
  }

  const triad = firstTriad(text);
  if (triad) {
    failures.push({
      gate: "voice",
      message: `Drop the three-item parallel list ("${triad}") — it is the clearest sign a machine wrote this.`,
    });
  }

  // A unit always holds at least one word, so the mean is never zero — and were
  // that ever to change, NaN fails this comparison, which is the safe direction.
  const lengths = unitLengths(markdown);
  if (lengths.length >= MIN_UNITS_FOR_RHYTHM && stdDev(lengths) / mean(lengths) < MIN_RELATIVE_SPREAD) {
    failures.push({
      gate: "voice",
      message: "Every sentence is about the same length. Vary them — a short one, then a longer one.",
    });
  }

  return failures;
};
