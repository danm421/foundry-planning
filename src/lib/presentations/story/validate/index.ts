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
   * to know who the reader is, and `Validator` has no room for it. Passed per
   * call rather than by widening the four shipped signatures.
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
  const gates = [...gatesFor(opts.enumerates ?? false), registerGate(names), foreignNamesGate(names)];
  return gates.flatMap((gate) => gate(markdown, facts));
}
