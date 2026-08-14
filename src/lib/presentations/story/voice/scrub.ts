// Turns one household's chapter into an exemplar safe to send while writing
// ANOTHER household's. Pure, framework-free, no DB — the same purity rule the
// gates are held to, and for the same reason: this is the check standing
// between one client's data and another client's prompt.
//
// It removes two things and keeps everything else:
//
//   NAMES   — the household's given names and its household name. Gate 7 exists
//             because this pass is not sufficient on its own: it only knows the
//             names of the household the sample came FROM.
//   FIGURES — every number. A figure is about one plan and no other, and a model
//             shown "$2.4M" in an exemplar will write it into a chapter where it
//             is false. Gate 1 would then reject that chapter and spend its one
//             retry on a word we handed it.
//
// What survives is rhythm, register, and the advisor's own turns of phrase,
// which is exactly what `prompts.ts` asks the model to copy: "Copy their rhythm
// and register, not their content."
//
// Nothing calls this yet. The harvest path that stores a scrubbed chapter as an
// exemplar arrives with the rest of Wave B; `run-context.ts` still hands the
// prompt an empty sample list. This is the pass that path is required to go
// through, written before it, not after.

function escapeLiteral(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** A name has to match as a WORD. Same rule, same reason, as
 *  `generate.ts#mentionsName`: "Alan" is a substring of "balance". */
function wordPattern(word: string): RegExp {
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeLiteral(word)}(?![\p{L}\p{N}])`, "giu");
}

/**
 * The household name as `load-context.ts` composes every one of them — `the
 * ${lastName} household`, give or take a plural.
 *
 * Absorbing the framing is the point. Swapping the surname alone turns "the
 * Sample household" into "the <stand-in> household", a stand-in wedged inside a
 * phrase that no longer parses. Taking the whole phrase leaves "the household",
 * which is what the sentence meant.
 *
 * ⚠️ The framing is REQUIRED here, and this pass runs FIRST — before the given
 * names — because the two can be the same word. `lastName` is nullable
 * (`engine/types.ts`), and `load-context.ts` falls back to the FIRST name, so a
 * client with no surname on file has a household called "the Cooper household".
 * Let the names pass reach it first and it becomes "the they household".
 */
function framedHouseholdPattern(surname: string): RegExp {
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:the\s+)?${escapeLiteral(surname)}s?\s+(?:household|family)(?![\p{L}\p{N}])`,
    "giu",
  );
}

/**
 * The surname loose in the prose — bare ("Sample"), possessive ("Sample's"),
 * plural ("the Samples").
 *
 * Runs LAST, after the given names, for the other half of the same reason: when
 * the two are the same word, "Cooper, your plan holds" is the person being
 * addressed and wants "they", not "the household". By the time this pass runs,
 * the framed phrase is already gone and every given name is spent, so what is
 * left really is the surname used on its own.
 */
function surnamePattern(surname: string): RegExp {
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:the\s+)?${escapeLiteral(surname)}s?(?![\p{L}\p{N}])`,
    "giu",
  );
}

/** "Cooper and Susan" → ["Cooper","Susan"]. The SAME split
 *  `generate.ts#firstNamesOf` makes — two splits that agree today is how a rule
 *  ends up applying to one and not the other. */
function namesIn(firstNames: string): string[] {
  return firstNames
    .split(/\s+and\s+|[,&]/u)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

/**
 * "the Sample household" → "Sample". Strips the framing off the stored household
 * name to leave the proper noun, which is what `surnamePattern` is then built
 * from — the framing is ordinary English and has to be matched loosely in the
 * prose rather than looked for literally.
 */
const HOUSEHOLD_FRAMING = /^(?:the\s+)?|(?:\s+(?:household|family|s))$/giu;

/**
 * Numbers that name a form or an account type rather than a household: `401(k)`,
 * `403(b)`, `457(b)`, `529`, `1031`, `1040`, `1099`. They are the tax code —
 * identical for every client, carrying nothing about this one — and they are
 * among the commonest numerals in the corpus, so scrubbing them buys no safety
 * and costs the vocabulary the sample was harvested for. The plan types are
 * listed with and without their parentheses, because an advisor writes both.
 *
 * ⚠️ Guarded on BOTH sides, because a real figure can contain the same digits.
 * The leading guard rejects a preceding `$`, digit, comma or point, so `$529K`
 * and `$1,099` are not read as forms; the trailing guard rejects a following
 * digit, comma, point, percent or magnitude letter, so `529,000` and `529K` are
 * not either. Only the bare form survives.
 */
const TERM_OF_ART = String.raw`(?<![$\p{N},.])(?:(?:529|1031|1040|1099)(?![\p{N},.%KMB])|401\(k\)|401k|403\(b\)|403b|457\(b\)|457b)`;

/**
 * A figure, in every shape this document writes and several it doesn't: `$2.4M`,
 * `$480K`, `$1,200`, `91%`, `2035`, a bare `12`. Broader than
 * `validate/facts.ts#extractFigures` on purpose — that one decides what a MODEL
 * may quote from a pack we control, this one decides what leaves a household.
 *
 * Both ends are closed against welding the stand-in to a neighbouring word, and
 * both were found by reading output rather than by an assertion:
 *
 *   LEADING   the whitespace sits INSIDE the magnitude group ("96 %"). Outside,
 *             it is eaten even when no magnitude follows, so "in 2035 and" came
 *             out as "in that amountand".
 *   TRAILING  `\p{L}*` takes any letters glued to the digits, so an ordinal or a
 *             decade goes whole — "January 1st" and "the mid-2030s" came out as
 *             "that amountst" and "that amounts". It also guarantees the
 *             character after a match is never a letter, which is what makes the
 *             weld impossible rather than merely unobserved.
 *
 * A comma only counts as a thousands separator when digits follow it. Written
 * `[\d,]*`, it also swallows the comma ENDING a clause — "Work ends in 2035, and
 * we plan…" came out as one long unpunctuated run. Comma placement is rhythm,
 * which is the one thing a sample is kept for.
 */
const FIGURE = String.raw`\$?\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:[KMB]\b|%))?\p{L}*`;

/**
 * `1.` opening a line is a list marker, not a figure — the same argument as the
 * terms of art, one level up: it carries nothing about a household, and it is
 * structure the model is being asked to copy. Scrubbed, every ordered list in
 * every sample turned into "That amount."
 *
 * Narrow on purpose, and the DIGIT CAP is the load-bearing part of that. It
 * requires the line start, a following space, and a run of at most two digits
 * ending in the marker punctuation — so "2035 was the year" and "1.5M" at the
 * head of a line are still figures, and so is a timeline written as a list:
 *
 *     2035. Work ends.
 *     2040. Social Security starts.
 *
 * Uncapped, that reads as an ordered list and every year in it leaves the
 * household intact. Two digits covers every real ordered list; a four-digit
 * "item number" is a year.
 */
const MARKDOWN_LIST_MARKER = String.raw`(?<![^\n])[ \t]*\d{1,2}[.)](?=[ \t])`;

/** What must SURVIVE first, so the figure branch never sees it. The capture is
 *  how the replacer tells "keep this" from "swap this". */
const SCRUBBABLE = new RegExp(
  String.raw`((?:${TERM_OF_ART})|(?:${MARKDOWN_LIST_MARKER}))|${FIGURE}`,
  "giu",
);

/** What replaces a removed token. A word, not a blank: the sentence has to keep
 *  its SHAPE, or the model is asked to copy the rhythm of prose full of holes.
 *  Its shape, not its grammar — "they owns" is a sample the model reads for
 *  length and cadence, and both survive the swap. */
const NAME_STAND_IN = "they";
const FIGURE_STAND_IN = "that amount";
/** The household gets its own stand-in rather than the people's. Reusing "they"
 *  produced "the they household", which is not a sentence in any register. */
const HOUSEHOLD_STAND_IN = "the household";

/**
 * Where a sentence can begin in MARKDOWN, which is what a chapter is: after a
 * full stop, on a new line, and after the marker that opens a heading, a bullet,
 * a numbered item or a quote. Headings and bullets are most of a chapter's
 * structure, so a rule that only knew about full stops left "## their Plan" and
 * "- they owns the boat" exactly as they were.
 */
const SENTENCE_OPENER = String.raw`(?:^|[.!?]["'’)\]]?\s+|\n)[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+\.[ \t]+|>[ \t]*)*`;

/**
 * A stand-in that lands where a sentence begins has to look like one.
 *
 * Grammar is excused above — "they owns" still carries its cadence — but
 * capitalisation is not: a lowercase sentence opener is a register defect, and
 * register is the only thing this text is kept for.
 *
 * It matches the four stand-ins by their WORDS, and cannot tell one this module
 * inserted from the same word the advisor typed: a stray lowercase "they" that
 * opened one of their sentences is capitalised too. That is a typo being fixed
 * rather than a voice being altered, and it is the price of not tracking the
 * provenance of every token — worth paying, but it is not "never touches their
 * prose".
 */
const STAND_IN_AT_SENTENCE_START = new RegExp(
  String.raw`(${SENTENCE_OPENER})(that amount|the household|their|they)\b`,
  "gu",
);

export function scrubSample(
  text: string,
  household: { firstNames: string; householdName: string },
): string {
  const surname = household.householdName.replace(HOUSEHOLD_FRAMING, "").trim();
  // ORDER IS LOAD-BEARING, and only when the surname and a given name are the
  // same word — which `load-context.ts` produces whenever `lastName` is null.
  // Framed household first, then the people, then whatever surname is left.
  let out = surname.length > 0 ? text.replace(framedHouseholdPattern(surname), HOUSEHOLD_STAND_IN) : text;
  for (const name of namesIn(household.firstNames)) {
    out = out.replace(wordPattern(name), NAME_STAND_IN);
  }
  if (surname.length > 0) out = out.replace(surnamePattern(surname), HOUSEHOLD_STAND_IN);
  out = out.replace(SCRUBBABLE, (_match, termOfArt: string | undefined) => termOfArt ?? FIGURE_STAND_IN);
  // A stand-in run together with its neighbour ("they, they") reads as damage
  // rather than as prose; collapse what the name and figure passes leave behind.
  return (
    out
      // "Cooper and Susan, your plan…" is the one shape `prompts.ts` permits a
      // name in, so "they and they" is a COMMON output, not a corner. It collapses
      // here and deliberately NOT below: two names are one referent, and "they"
      // already says both. Two figures are two figures, and "between that amount
      // and that amount" must keep its second half.
      .replace(/\b(they)(?:(?:[\s,]+|\s+and\s+)\1\b)+/giu, "$1")
      .replace(/\b(that amount)(?:[\s,]+\1\b)+/giu, "$1")
      // "Susan's 401(k)" is a shape Gate 6 deliberately permits, so a harvested
      // chapter contains it and the swap above leaves "they's".
      .replace(/\bthey['’]s\b/giu, "their")
      // Close the gap a removal leaves — but only INSIDE a line. Leading
      // whitespace is indentation, and in CommonMark indentation is what nests a
      // list; flattened, "- a" / "  - b" / "    - c" become three siblings, and
      // the sample teaches the model a structure the advisor did not write.
      .replace(/(?<=\S)[ \t]{2,}/gu, " ")
      .trim()
      .replace(STAND_IN_AT_SENTENCE_START, (_m, before: string, word: string) => (
        `${before}${word[0].toUpperCase()}${word.slice(1)}`
      ))
  );
}
