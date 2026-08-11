// Runs every gate and returns the union of their failures — all of them, not
// the first. The single retry prompt names every rule the model broke, so one
// regeneration can fix all of them rather than trading one failure for another.
import type { Fact } from "../facts";
import { validateFacts } from "./facts";
import { validateReadability, validateNoAdvice } from "./readability";
import { validateVoice } from "./voice";
import type { GateFailure, Validator } from "./types";

export type { GateFailure, GateId, Validator } from "./types";

const GATES: Validator[] = [validateFacts, validateReadability, validateNoAdvice, validateVoice];

export function runGates(markdown: string, facts: Fact[]): GateFailure[] {
  return GATES.flatMap((gate) => gate(markdown, facts));
}
