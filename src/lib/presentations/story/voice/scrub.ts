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
//             retry on a word we handed it. Every one of them goes; what replaces
//             it matches the KIND of figure it was, so the sentence around it is
//             still English — see `figureStandIn`.
//
// What survives is rhythm, register, and the advisor's own turns of phrase,
// which is exactly what `prompts.ts` asks the model to copy: "Copy their rhythm
// and register, not their content."
//
// ONE caller, and that is the guarantee: `POST /api/story-voice/samples` runs
// this on the way in, and it is the only handler that calls
// `insertVoiceSample`. Nothing scrubs on read, because a row that reached the
// table unscrubbed would already be readable into another household's prompt.

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
/** The household gets its own stand-in rather than the people's. Reusing "they"
 *  produced "the they household", which is not a sentence in any register. */
const HOUSEHOLD_STAND_IN = "the household";

/**
 * A figure's stand-in matches its KIND, because one word for all of them is not
 * English.
 *
 * ⚠️ The first real harvest, 2026-08-14, stored "Work income stops in that
 * amount. The plan runs to that amount." and "the confidence level, which is
 * that amount" — and `prompts.ts` prints, one line above the samples, "Copy
 * their rhythm and register". Six "that amount"s in a passage IS a rhythm, and
 * it is one no advisor wrote. This text's ONLY job is to read like their
 * writing, so a stand-in that breaks the sentence costs the whole sample.
 *
 * These three are what the corpus actually holds — a date, a rate, a sum — and
 * anything else falls back to the amount. An age is the fallback's known cost:
 * "You claim at 67" comes out as "You claim at that amount", which is clumsy.
 * Clumsy is the whole cost, because the fallback is still a stand-in — no input
 * reaches a branch that declines to replace the figure.
 */
const AMOUNT_STAND_IN = "that amount";
const YEAR_STAND_IN = "that year";
const RATE_STAND_IN = "that rate";
/** Every figure stand-in, so the rules downstream (capitalisation, collapsing)
 *  cover the kinds by construction. Naming one of them by hand is how a kind
 *  ends up with half the treatment. */
const FIGURE_STAND_INS = [AMOUNT_STAND_IN, YEAR_STAND_IN, RATE_STAND_IN];

/**
 * A year is four bare digits in this century or the last, and NOTHING else.
 *
 * ⚠️ The bareness is the whole test. A currency mark, a thousands separator or a
 * decimal point all say the digits are a quantity that merely reads like a date
 * — "$2035 a month", "2,035 hours", "2035.40" — and calling one of those a year
 * writes a sentence about time out of a sentence about money. Guarded by the
 * `$` and `[KMB]` checks above it and by the anchors here.
 */
const YEAR = /^(?:19|20)\d{2}$/u;

/**
 * Which stand-in a matched figure takes, decided from the figure's own SHAPE.
 *
 * ⭐ It changes the WORD and never the coverage: every branch returns a stand-in,
 * so every figure `SCRUBBABLE` matches is still replaced. There is no path here
 * that returns the digits.
 */
function figureStandIn(figure: string): string {
  if (figure.includes("%")) return RATE_STAND_IN;
  // A magnitude letter is money in this corpus ("$4.7M", "480K"), and it is what
  // keeps a quantity that happens to be four digits — "2035K" — off the year
  // branch below.
  //
  // ⚠️ Case-insensitive because the FIGURE STRING reaching this function carries
  // the magnitude letter in whatever case the advisor wrote it. `SCRUBBABLE` is
  // compiled `giu`, so its own `[KMB]` already matches either case — measured:
  // "2035 k" matches as ["2035 k"] under `giu` and only ["2035"] under `gu`.
  // A case-SENSITIVE test here therefore read "2035k" as a year. ("2035 k" landed
  // on the amount either way, because the space it leaves behind defeats the
  // anchored year test below — so it is a control here, not a second red.)
  if (figure.includes("$") || /\d\s*[KMB]/iu.test(figure)) return AMOUNT_STAND_IN;
  // `FIGURE` takes any letters glued to the digits, so "the mid-2030s" arrives
  // as "2030s" and "January 1st" as "1st". The digits are what carries the kind.
  return YEAR.test(figure.replace(/\p{L}+$/u, "")) ? YEAR_STAND_IN : AMOUNT_STAND_IN;
}

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
  // Built from the constants, so a kind added above cannot be left uncapitalised
  // here. No entry is a prefix of another, so the alternation's order carries
  // nothing — it is the order they are declared in, and nothing more.
  //
  // Escaped for the same reason the name patterns are: none of the six holds a
  // metacharacter today, so this changes no behaviour — it is what keeps a stand-in
  // that one day holds a "." or a "(" from silently widening the rule instead of
  // matching itself.
  String.raw`(${SENTENCE_OPENER})(${[...FIGURE_STAND_INS, HOUSEHOLD_STAND_IN, "their", NAME_STAND_IN].map(escapeLiteral).join("|")})\b`,
  "gu",
);

/**
 * A run of the SAME stand-in, which is what two adjacent figures leave behind.
 * The backreference is what keeps it to one kind — "that amount that year" is two
 * different figures and reads as two.
 *
 * ⚠️ It cannot tell a stand-in this module inserted from the same words the
 * advisor typed — the same blind spot `STAND_IN_AT_SENTENCE_START` documents, and
 * the kind stand-ins widened it: "that year" and "that rate" are ordinary English
 * an advisor writes, where "that amount" mostly is not. So an appositive loses
 * its middle:
 *
 *     "In that year, 2035, work ends."           → "In that year, work ends."
 *     "It grows at that rate, 6.5%, every year." → "It grows at that rate, every year."
 *
 * Both still read as English, and what is dropped is the figure the advisor was
 * glossing — which had to go regardless. So this is prose risk, not damage, and
 * the suite pins the shape so it stays a decision rather than a surprise.
 */
const REPEATED_FIGURE_STAND_IN = new RegExp(
  String.raw`\b(${FIGURE_STAND_INS.map(escapeLiteral).join("|")})(?:[\s,]+\1\b)+`,
  "giu",
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
  out = out.replace(SCRUBBABLE, (match: string, keep: string | undefined) => keep ?? figureStandIn(match));
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
      .replace(REPEATED_FIGURE_STAND_IN, "$1")
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
