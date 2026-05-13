// src/lib/tax/state-income/ss-subtraction.ts
import type { SsTreatment } from "./types";

export interface SsSubtractionInput {
  rule: SsTreatment;
  taxableSocialSecurity: number;
  agi: number;
  age: number;
  isJoint: boolean;
}

export interface SsSubtractionResult {
  amount: number;
  note: string;
}

export function computeSsSubtraction(input: SsSubtractionInput): SsSubtractionResult {
  const ss = Math.max(0, input.taxableSocialSecurity);
  if (input.rule.kind === "exempt") {
    return { amount: ss, note: "SS fully exempt at state level." };
  }
  if (input.rule.kind === "taxed") {
    return { amount: 0, note: "SS fully taxable at state level." };
  }
  // conditional
  if (input.rule.ageFullExemption != null && input.age >= input.rule.ageFullExemption) {
    return { amount: ss, note: `Age ${input.age} >= ${input.rule.ageFullExemption}: full SS exemption.` };
  }
  const threshold = input.isJoint ? input.rule.jointAgiThreshold : input.rule.singleAgiThreshold;
  if (threshold != null && input.agi < threshold) {
    return { amount: ss, note: `AGI $${input.agi} below threshold $${threshold}: full SS exemption.` };
  }
  return { amount: 0, note: `AGI $${input.agi} meets/exceeds threshold: SS taxed at state level.` };
}
