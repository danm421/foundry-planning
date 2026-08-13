// Runs every gate and returns the union of their failures — all of them, not
// the first. The single retry prompt names every rule the model broke, so one
// regeneration can fix all of them rather than trading one failure for another.
import type { Fact } from "../facts";
import { validateFacts } from "./facts";
import { validateReadability, validateReadabilityEnumerating, validateNoAdvice } from "./readability";
import { validateVoice, validateVoiceEnumerating } from "./voice";
import { validateLabels, registerGate } from "./register";
import type { GateFailure, Validator } from "./types";

export type { GateFailure, GateId, Validator } from "./types";

export interface GateOptions {
  /**
   * The household's given names, split — Gate 6 is the one gate that has to
   * know who the reader is, and `Validator` has no room for it. Passed per call
   * rather than by widening the four shipped signatures.
   *
   * Defaulted to empty so a caller with no household simply skips the name half
   * of Gate 6 rather than throwing; the self-reference and third-person-noun
   * halves still run, and both are name-independent.
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
  const gates = [...gatesFor(opts.enumerates ?? false), registerGate(opts.firstNames ?? [])];
  return gates.flatMap((gate) => gate(markdown, facts));
}
