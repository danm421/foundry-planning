// Runs every gate and returns the union of their failures — all of them, not
// the first. The single retry prompt names every rule the model broke, so one
// regeneration can fix all of them rather than trading one failure for another.
import type { Fact } from "../facts";
import { validateFacts } from "./facts";
import { validateReadability, validateNoAdvice } from "./readability";
import { validateVoice } from "./voice";
import { validateLabels, registerGate } from "./register";
import type { GateFailure, Validator } from "./types";

export type { GateFailure, GateId, Validator } from "./types";

/** The gates that need nothing but the draft and the pack. */
const GATES: Validator[] = [
  validateFacts,
  validateReadability,
  validateNoAdvice,
  validateVoice,
  validateLabels,
];

/**
 * `firstNames` is the household's given names, split — Gate 6 is the one gate
 * that has to know who the reader is, and `Validator` has no room for it. Passed
 * per call rather than by widening the four shipped signatures.
 *
 * Defaulted to empty so a caller with no household simply skips the name half of
 * Gate 6 rather than throwing; the self-reference and third-person-noun halves
 * still run, and both are name-independent.
 */
export function runGates(markdown: string, facts: Fact[], firstNames: string[] = []): GateFailure[] {
  return [...GATES, registerGate(firstNames)].flatMap((gate) => gate(markdown, facts));
}
