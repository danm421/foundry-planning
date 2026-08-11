// Gates 2 and 3. Both are deterministic and run with no LLM, so the rules a
// client-facing document must satisfy are unit-testable rather than a hope
// pinned on a system prompt.
//
// Like Gate 1, both err toward matching MORE — but only where the extra match
// is still the thing being banned. A gate that rejects plain, correct prose
// burns the chapter's single retry on a note the model cannot act on, so the
// false-positive tests in the suite are as load-bearing as the rejections.
import type { GateFailure, Validator } from "./types";

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
/** Every punctuation a writer actually glosses with, not just the tidy two. */
const GLOSS_MARKERS = ["—", "–", "(", ":", ", meaning", "i.e.", "which means", "that is", "in other words"];

/** Markdown allows up to three spaces of indent before the hashes. */
const HEADING_RE = /^ {0,3}(#{1,6})\s/gmu;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The unit both gates measure. A chapter is markdown, so a line break ends a
 * unit as surely as a full stop does: headings and bullets carry no terminal
 * punctuation, and welding them to their neighbours turns three short bullets
 * into one forty-word "sentence" that fails the length rule and hands a later
 * line's parenthesis to an earlier line's jargon.
 */
function splitUnits(markdown: string): string[] {
  return markdown.split(/\r?\n/u).flatMap(splitSentences);
}

function words(s: string): string[] {
  return s.split(/\s+/u).filter(Boolean);
}

function wordCount(s: string): number {
  return words(s).length;
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

export const validateReadability: Validator = (markdown) => {
  const sentences = splitUnits(markdown);
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
      message: `One sentence runs ${counts[runaway]} words, starting "${words(sentences[runaway]).slice(0, 8).join(" ")}…". Split it — keep every sentence under ${MAX_SENTENCE_WORDS} words.`,
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
};

// Gate 3. The rule is that the document must never instruct the reader to buy,
// sell, or move a specific holding. Two shapes carry that instruction, and a
// test for either one alone is blind to the other:
//
//   a bare imperative  — "Sell your Apple shares."  (no subject, no modal)
//   a prescriptive frame — "You should sell…", "We recommend selling…"
//
// The frame has to *govern* the verb. "You can see that the plan moves money
// into bonds" contains both halves and instructs nobody, so a test that merely
// asks whether each appears somewhere in the sentence rejects ordinary prose.

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
  ["shift", String.raw`shift(?:s|ing)?`],
  ["trim", String.raw`trim(?:s|ming)?`],
  ["rebalance", String.raw`rebalanc(?:e|es|ing)`],
  ["reallocate", String.raw`reallocat(?:e|es|ing)`],
  ["convert", String.raw`convert(?:s|ing)?`],
  ["roll", String.raw`roll(?:s|ing)?`],
  ["invest", String.raw`invest(?:s|ing)?`],
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
    String.raw`\bwe(?:['’]d| would| might| may| do)?\s+(?:recommend|suggest|advise)\b`,
    String.raw`\bit\s+(?:makes|would\s+make)\s+sense\s+to\b`,
    String.raw`\b(?:your|the)\s+(?:next|first|best)\s+(?:step|move)\s+is\s+to\b`,
    String.raw`\bthe\s+(?:best|right)\s+move\s+(?:is|would\s+be)\b`,
  ].join("|"),
  "giu",
);

/**
 * How far past the frame the verb may sit and still be governed by it.
 * "you should | sell your shares" instructs; "you can | see that the plan moves
 * money into bonds" is an observation with a verb four words downstream.
 */
const GOVERNED_WORDS = 3;
/** A frame introduced by one of these describes a choice, not an instruction:
 *  "If you want to sell the house, the plan improves." */
const CONDITIONAL_RE = /^(?:if|when|whether|unless|though|although|because|while)$/iu;

function prescribes(sentence: string): boolean {
  for (const match of sentence.matchAll(PRESCRIPTION_RE)) {
    const preceding = words(sentence.slice(0, match.index)).pop() ?? "";
    if (CONDITIONAL_RE.test(preceding.replace(/[^\p{L}]/gu, ""))) continue;
    const governed = words(sentence.slice(match.index + match[0].length)).slice(0, GOVERNED_WORDS);
    if (governed.some((word) => ACTION_RE.test(word))) return true;
  }
  return false;
}

/** Bullet and blockquote markers, so a bulleted instruction still reads as one. */
const LIST_MARKER = String.raw`[\s>*_#+•-]*`;
/** A clause can also open with the conjunction that joins it on: "…, so sell
 *  your Apple shares." The verb still has to come straight after it. */
const CLAUSE_LEAD = String.raw`(?:(?:so|and|then|also|next|therefore|instead)\s+)?`;
/** `(?![-\w])` rather than `\b`: it also rejects the hyphen that turns the verb
 *  into a compound ("Buy-and-hold investing keeps your costs low"). */
const IMPERATIVE_RE = new RegExp(
  String.raw`^${LIST_MARKER}${CLAUSE_LEAD}(?:${HEDGE}\s+${ACTION}|${ACTION_BASE})(?![-\w])`,
  "iu",
);
/**
 * …and these turn it into the head of a noun phrase: "Purchase price on the
 * house was four hundred thousand dollars" opens a statement, not a command.
 *
 * Deliberately excludes `option`/`options`: an option is a holding in this
 * domain, so "Sell options in your account" is the instruction Gate 3 exists to
 * stop, not a noun phrase. Nothing here may name something a client can own.
 */
const COMPOUND_NOUN_RE = /^(?:price|prices|power|side|order|orders|cost|costs|date|amount|amounts)\b/iu;

/**
 * What an imperative's object opens with: a determiner, a possessive, a quantity,
 * a holding named without one ("sell options"), or a proper noun ("sell Apple
 * shares" — mid-sentence capitalisation is a reliable signal in generated prose).
 *
 * Required of a NON-INITIAL clause only. Position is evidence: at the start of a
 * unit a bare action verb is already a strong imperative signal, but mid-sentence
 * English routinely fronts a noun phrase headed by one of these same words —
 * "…, and shift work continues until 2030" — and every one of the thirteen base
 * lemmas doubles as a noun or modifier in this domain. Without the object test a
 * clause-level check cannot tell "so sell your Apple shares" from "so sell
 * decisions have a tax cost".
 */
const OBJECT_HEAD_RE = new RegExp(
  [
    String.raw`^(?:your|the|a|an|my|our|its|their|his|her|this|that|these|those)\b`,
    String.raw`^(?:all|both|each|every|any|some|most|half|part|more|less|another|it|them|everything)\b`,
    String.raw`^(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b`,
    String.raw`^\$?\d`,
    String.raw`^(?:shares?|stocks?|bonds?|equities|options?|funds?|positions?|holdings?|securities|assets|treasur(?:y|ies)|etfs?|reits?)\b`,
  ].join("|"),
  "iu",
);
/** Case-sensitive by necessity: mid-clause capitalisation is the whole signal,
 *  and an `i` flag would make `\p{Lu}` match every lowercase noun as well. */
const PROPER_NOUN_RE = /^\p{Lu}/u;

function commands(clause: string, initial: boolean): boolean {
  const match = IMPERATIVE_RE.exec(clause);
  if (!match) return false;
  const object = clause.slice(match[0].length).trim();
  if (COMPOUND_NOUN_RE.test(object)) return false;
  // Every test here is anchored to the head of the object. Two looser variants
  // were measured and rejected: scanning the first three words for a holding
  // ("sell municipal bonds") and treating a one-word object as a command
  // ("sell now"). Each closed a narrow miss and re-opened the common over-fire
  // this rule exists to stop — "so sell decisions on bonds cost more", "and
  // switch options for you are limited", "and trim helps". See the round-3 fix
  // report; the misses they would have closed are named there, deliberately.
  return initial || OBJECT_HEAD_RE.test(object) || PROPER_NOUN_RE.test(object);
}

/**
 * An imperative is checked per clause, not per sentence. The conditional guard
 * in `prescribes` exempts the frame, and `commands` is anchored to the start of
 * what it is given — so a sentence-level check leaves the main clause of "If you
 * want to reduce risk, sell your Apple shares." examined by neither half, and
 * any conditional prefix becomes a way through the gate.
 */
function clauses(sentence: string): string[] {
  return sentence.split(/[,;]/u).map((clause) => clause.trim()).filter(Boolean);
}

export const validateNoAdvice: Validator = (markdown) =>
  splitUnits(markdown)
    .filter(
      (sentence) =>
        clauses(sentence).some((clause, index) => commands(clause, index === 0)) || prescribes(sentence),
    )
    .map((sentence) => ({
      gate: "advice",
      // Name the sentence: this message is reused verbatim in the retry prompt,
      // and a chapter with three instructions must not spend its one retry
      // fixing a third of them.
      message: `Do not instruct the reader to buy, sell, or move a specific holding. Describe what the plan shows instead. Rewrite: "${sentence}"`,
    }));
