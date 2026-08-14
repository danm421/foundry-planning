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

/** A name has to match as a WORD. Same rule, same reason, as
 *  `generate.ts#mentionsName`: "Alan" is a substring of "balance". */
function wordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, "giu");
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
 * "the Sample household" → "Sample". The framing words are ordinary English and
 * must survive in the prose; only the proper noun in the middle is the
 * household's, so only that is worth searching the sample for.
 */
const HOUSEHOLD_FRAMING = /^(?:the\s+)?|(?:\s+(?:household|family|s))$/giu;

/**
 * A figure, in every shape this document writes and several it doesn't: `$2.4M`,
 * `$480K`, `$1,200`, `91%`, `2035`, a bare `12`. Broader than
 * `validate/facts.ts#extractFigures` on purpose — that one decides what a MODEL
 * may quote from a pack we control, this one decides what leaves a household.
 *
 * The whitespace sits INSIDE the magnitude group ("96 %") rather than before it.
 * Outside, it is consumed even when no magnitude follows, so "in 2035 and" loses
 * the space and the stand-in welds itself to the next word. A sample exists to be
 * copied for its rhythm; prose full of run-together words teaches the model
 * damage, and no "the digits are gone" assertion can see it.
 */
const FIGURE_RE = /\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:[KMB]\b|%))?/giu;

/** What replaces a removed token. A word, not a blank: the sentence has to keep
 *  its SHAPE, or the model is asked to copy the rhythm of prose full of holes.
 *  Its shape, not its grammar — "they owns" is a sample the model reads for
 *  length and cadence, and both survive the swap. */
const NAME_STAND_IN = "they";
const FIGURE_STAND_IN = "that amount";

export function scrubSample(
  text: string,
  household: { firstNames: string; householdName: string },
): string {
  let out = text;
  for (const name of namesIn(household.firstNames)) {
    out = out.replace(wordPattern(name), NAME_STAND_IN);
  }
  const surname = household.householdName.replace(HOUSEHOLD_FRAMING, "").trim();
  if (surname.length > 0) out = out.replace(wordPattern(surname), NAME_STAND_IN);
  out = out.replace(FIGURE_RE, FIGURE_STAND_IN);
  // A stand-in run together with its neighbour ("they, they") reads as damage
  // rather than as prose; collapse the runs the two passes leave behind.
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
      .replace(/[ \t]{2,}/gu, " ")
      .trim()
  );
}
