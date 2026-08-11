// Gates 2 and 3. Both are deterministic and run with no LLM, so the rules a
// client-facing document must satisfy are unit-testable rather than a hope
// pinned on a system prompt.
//
// Like Gate 1, both err toward matching MORE. A false positive costs one retry;
// a false negative puts an unexplained term — or an instruction to sell a
// holding — in front of a client, which is the thing these gates exist to stop.
import type { Fact } from "../facts";
import type { GateFailure } from "./types";

/** Terms a lay reader does not know. Allowed only when glossed in the same
 *  sentence — signalled by an em-dash, a parenthetical, or "which means". */
export const BANNED_JARGON = [
  "decumulation",
  "sequence-of-returns",
  "tax-deferred",
  "basis point",
  "drawdown",
  "stochastic",
  "asset-liability",
  "efficient frontier",
  "tax alpha",
  "glidepath",
] as const;

const MAX_MEAN_SENTENCE_WORDS = 20;
/**
 * A mean alone cannot see a monster: nine four-word sentences pull the average
 * of a ninety-word one back under the limit, and that sentence is exactly what
 * this gate exists to stop. The cap is twice the mean limit, so it only fires on
 * prose no advisor would hand a client.
 */
const MAX_SENTENCE_WORDS = MAX_MEAN_SENTENCE_WORDS * 2;
const GLOSS_MARKERS = ["—", "(", "which means", "that is", "in other words"];

/** Markdown allows up to three spaces of indent before the hashes. */
const HEADING_RE = /^ {0,3}(#{1,6})\s/gmu;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Exported for the same reason as `splitSentences`: Gate 4b's sentence-rhythm
 *  check counts words the same way, and two spellings of it would drift. */
export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Emphasis is decoration, not spelling: `de**cumulation**` is one word. */
function stripEmphasis(sentence: string): string {
  return sentence.replace(/[*_]/gu, "");
}

/**
 * A banned term is matched across every separator a model actually writes:
 * the hyphen the list uses, a plain space ("sequence of returns" is how most
 * people spell it), or a unicode dash. Matching the literal string only would
 * let the most natural spelling of the term straight through.
 */
function jargonRegex(term: string): RegExp {
  return new RegExp(term.split(/[\s-]+/u).join(String.raw`[\s\u2010-\u2015-]+`), "iu");
}

const JARGON = BANNED_JARGON.map((term) => [term, jargonRegex(term)] as const);

/** The first sentence that uses `re`, with the match that found it. */
function firstUse(sentences: string[], re: RegExp): { sentence: string; match: RegExpExecArray } | null {
  for (const sentence of sentences) {
    const match = re.exec(sentence);
    if (match) return { sentence, match };
  }
  return null;
}

function jargonFailures(sentences: string[]): GateFailure[] {
  const flattened = sentences.map(stripEmphasis);
  const failures: GateFailure[] = [];
  for (const [term, re] of JARGON) {
    const use = firstUse(flattened, re);
    if (!use) continue;
    // The gloss has to explain THIS term, so it has to follow it. A dash or a
    // parenthesis anywhere in the sentence is not a gloss — "Your withdrawals —
    // steady and predictable — come from a tax-deferred account" explains
    // something else entirely, and reading it as a gloss waves the term through.
    //
    // Known residual: a marker that trails the term without explaining it
    // ("…risk carefully (see the appendix)") still counts. Separating those
    // needs to read the words, which no deterministic rule here can do, and
    // every distance cutoff tried rejected real glosses instead.
    const after = use.sentence.slice(use.match.index + use.match[0].length).toLowerCase();
    if (GLOSS_MARKERS.some((marker) => after.includes(marker))) continue;
    failures.push({
      gate: "readability",
      message: `"${term}" is jargon a client will not know. Either explain it in the same sentence or drop it.`,
    });
  }
  return failures;
}

export function validateReadability(markdown: string, _facts: Fact[]): GateFailure[] {
  const sentences = splitSentences(markdown);
  const failures: GateFailure[] = jargonFailures(sentences);

  const counts = sentences.map(wordCount);

  if (counts.length > 0) {
    const mean = counts.reduce((sum, n) => sum + n, 0) / counts.length;
    if (mean > MAX_MEAN_SENTENCE_WORDS) {
      failures.push({
        gate: "readability",
        message: `The sentences are too long (averaging ${Math.round(mean)} words). Aim under ${MAX_MEAN_SENTENCE_WORDS}.`,
      });
    }
  }

  const runaway = counts.findIndex((n) => n > MAX_SENTENCE_WORDS);
  if (runaway >= 0) {
    failures.push({
      gate: "readability",
      // Quote the opening so the retry prompt names the sentence to split; the
      // message is reused verbatim, and "one sentence is long" is unactionable.
      message: `One sentence runs ${counts[runaway]} words, starting "${sentences[runaway].split(/\s+/).slice(0, 8).join(" ")}…". Split it — keep every sentence under ${MAX_SENTENCE_WORDS} words.`,
    });
  }

  // Two heading depths anywhere in the chapter is a nested heading, whether or
  // not either of them is an `###` — `# Title` over `## Section` is the shape a
  // model actually produces.
  const levels = new Set([...markdown.matchAll(HEADING_RE)].map((m) => m[1].length));
  if (levels.size > 1) {
    failures.push({
      gate: "readability",
      message: "Remove the nested heading — this page allows at most one level of heading.",
    });
  }

  return failures;
}

// Gate 3. The spec's rule is "observations and mechanisms, never individualized
// recommendations — reject second-person imperatives about buying or selling".
// An imperative has no subject and no modal, so a frame-only test ("you should")
// cannot see the plainest form of the thing being banned: "Sell your Apple
// shares." Both shapes are checked, per sentence.
/** One row per banned verb: the base form, then every form it is written in.
 *  Both patterns below derive from this, so a verb cannot be added to one and
 *  forgotten in the other. */
const ACTION_VERBS = [
  ["buy", String.raw`buy(?:s|ing)?`],
  ["sell", String.raw`sell(?:s|ing)?`],
  ["purchase", String.raw`purchas(?:e|es|ing)`],
  ["liquidate", String.raw`liquidat(?:e|es|ing)`],
  ["move", String.raw`mov(?:e|es|ing)`],
  ["switch", String.raw`switch(?:es|ing)?`],
] as const;

const ACTION = `(?:${ACTION_VERBS.map(([, forms]) => forms).join("|")})`;
/** Base forms only — "Selling the position raises tax" is an observation. */
const ACTION_BASE = `(?:${ACTION_VERBS.map(([base]) => base).join("|")})`;
const HEDGE = String.raw`(?:consider|please|start by|be sure to|make sure to)`;

const ACTION_RE = new RegExp(String.raw`\b${ACTION}\b`, "iu");

/** Frames that turn a sentence about the plan into an instruction to the reader. */
const PRESCRIPTION_RE = new RegExp(
  [
    String.raw`\byou(?:['’](?:ll|d)| will| would)?\s+(?:should(?:n['’]?t| not)?|must|needs?\s+to|ought\s+to|have\s+to|may\s+want\s+to|might\s+want\s+to|want\s+to|could|can)\b`,
    String.raw`\bwe\s+(?:recommend|suggest|advise)\b`,
    String.raw`\bit\s+(?:makes|would\s+make)\s+sense\s+to\b`,
    String.raw`\bthe\s+(?:best|right)\s+move\s+(?:is|would\s+be)\b`,
  ].join("|"),
  "iu",
);

/** A bare imperative: the sentence opens with the action itself. */
const IMPERATIVE_RE = new RegExp(
  String.raw`^[\s>*_#-]*(?:${HEDGE}\s+${ACTION}|${ACTION_BASE})\b`,
  "iu",
);

export function validateNoAdvice(markdown: string, _facts: Fact[]): GateFailure[] {
  // Per sentence, and per line so a bulleted instruction is judged on its own.
  // Testing the whole document lets a "you should" in one sentence pair with a
  // "move" three sentences later and reject prose that instructs nobody.
  const offender = markdown
    .split(/\r?\n/u)
    .flatMap(splitSentences)
    .find((s) => IMPERATIVE_RE.test(s) || (PRESCRIPTION_RE.test(s) && ACTION_RE.test(s)));
  if (!offender) return [];
  return [{
    gate: "advice",
    message: `Do not instruct the reader to buy, sell, or move a specific holding. Describe what the plan shows instead. Rewrite: "${offender}"`,
  }];
}
