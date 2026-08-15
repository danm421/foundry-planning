// Runs every gate and returns the union of their failures — all of them, not
// the first. The single retry prompt names every rule the model broke, so one
// regeneration can fix all of them rather than trading one failure for another.
import type { Fact } from "../facts";
import { validateFacts } from "./facts";
import { validateReadability, validateReadabilityEnumerating, validateNoAdvice } from "./readability";
import { validateVoice, validateVoiceEnumerating } from "./voice";
import { validateLabels, registerGate } from "./register";
import { foreignNamesGate } from "./foreign-names";
import type { GateFailure, Validator } from "./types";

export type { GateFailure, GateId, Validator } from "./types";

export interface GateOptions {
  /**
   * The household's given names, split — Gates 6 and 7 are the gates that have
   * to know who the reader is, and the `Validator` signature every gate shares
   * has no room for it. Passed per call rather than widened into that signature.
   *
   * Defaulted to empty, and the two gates degrade differently on that default.
   * Gate 6 skips its name half and still runs the self-reference and
   * third-person-noun halves, both name-independent. Gate 7 loses the only list
   * of names it may NOT report, so with no household every dictionary name in
   * the draft is foreign — correct for a caller with no household, and the
   * reason a caller that has one must pass it.
   */
  firstNames?: string[];
  /**
   * Text this household's own record supplied — goal names and strategy labels,
   * both typed by hand and both reaching the prose. Gate 7 treats every word of
   * it as a name it may not report.
   *
   * SEPARATE from `firstNames` on purpose, and not a widening of it: Gate 6
   * reads that same field and means something far narrower by it — the people
   * the chapter may address directly. A goal called "College for Emma" must not
   * teach Gate 6 that "Emma" is a person this chapter can speak to.
   */
  householdText?: string[];
  /**
   * True for a chapter whose job is to NAME things — every strategy in a
   * proposal, every account a household owns. Two rules move for it, both
   * documented where they are defined: a looser mean sentence length, and the
   * rhetorical-triad rule off.
   *
   * Every caller derives it from `chapters/registry.ts#chapterEnumerates`, which
   * is also what the prompt reads — a chapter must never be judged under a rule
   * the model was told a different version of.
   */
  enumerates?: boolean;
}

/**
 * ONE list, with two of its entries swapped — never two lists. A gate added to
 * a second copy of this array and forgotten in the first is a rule that runs on
 * most chapters, which is the failure this shape makes impossible.
 */
function gatesFor(enumerates: boolean): Validator[] {
  return [
    validateFacts,
    enumerates ? validateReadabilityEnumerating : validateReadability,
    validateNoAdvice,
    enumerates ? validateVoiceEnumerating : validateVoice,
    validateLabels,
  ];
}

export function runGates(markdown: string, facts: Fact[], opts: GateOptions = {}): GateFailure[] {
  const names = opts.firstNames ?? [];
  const gates = [
    ...gatesFor(opts.enumerates ?? false),
    registerGate(names),
    foreignNamesGate(names, opts.householdText ?? []),
  ];
  return gates.flatMap((gate) => gate(markdown, facts));
}

/**
 * Bumped whenever a gate is added or tightened. Stored on every generated
 * chapter, so a tightening can REACH text already written — which nothing could
 * do before, because `ai-cache.ts` holds an answer for 30 days and cannot delete
 * an entry, and the stored row outlives the cache.
 *
 * The staleness route reads it beside `sourceHash`: a chapter written under an
 * older set is out of date in exactly the sense the badge already means — the
 * words on the page are not the words this build would write.
 *
 * ⚠️ Bumping this reports every stored chapter in every firm out of date at
 * once. That is correct and it is also a support event: say so in the release
 * note, and never bump it for a gate's message wording.
 *
 * 1  `GateId` at this plan's merge-base (`151fee59c`) — six gates: facts,
 *    readability, advice, voice, labels, register.
 * 2  This plan's Task 5 adds `foreignName` as a seventh gate (`foreign-names.ts`).
 */
export const GATE_VERSION = 2;
