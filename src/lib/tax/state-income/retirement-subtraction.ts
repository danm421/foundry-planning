// src/lib/tax/state-income/retirement-subtraction.ts
import type { RetirementRule } from "./types";

export interface RetirementSubtractionInput {
  rule: RetirementRule;
  breakdown: { db: number; ira: number; k401: number; annuity: number };
  isJoint: boolean;
  age: number;
  agi: number;
  filers: 1 | 2;
}

export interface RetirementSubtractionResult {
  amount: number;
  note: string;
}

/** Compute the state-level retirement-income subtraction for a single year.
 *
 *  Pure function; no engine/IO imports. Logic order:
 *  1. Age gate — if rule has an age threshold and the (older) filer is below it, return 0.
 *  2. AGI cliff — if rule has an AGI threshold for the filing status and AGI meets/exceeds it, return 0.
 *  3. Sum qualifying retirement income (only the buckets where `rule.applies.<kind>` is true).
 *  4. Apply per-filer cap: `perFilerCap * filers` (or Infinity if no cap).
 *
 *  Note: CO's combined SS + retirement cap is applied by the caller (compute.ts),
 *  not here — this function only knows about the retirement bucket. */
export function computeRetirementSubtraction(
  input: RetirementSubtractionInput,
): RetirementSubtractionResult {
  const { rule, breakdown, isJoint, age, agi, filers } = input;

  // Age threshold: if rule has one and client below it, no subtraction.
  if (rule.ageThreshold != null && age < rule.ageThreshold) {
    return {
      amount: 0,
      note: `Age ${age} below threshold ${rule.ageThreshold}: no retirement subtraction.`,
    };
  }

  // AGI cliff: if rule has thresholds and AGI ≥ threshold, no subtraction.
  const agiThreshold = isJoint ? rule.agiThresholdJoint : rule.agiThresholdSingle;
  if (agiThreshold != null && agi >= agiThreshold) {
    return {
      amount: 0,
      note: `AGI $${agi} ≥ threshold $${agiThreshold}: no retirement subtraction.`,
    };
  }

  // Sum applicable income types.
  let qualifying = 0;
  if (rule.applies.db) qualifying += breakdown.db;
  if (rule.applies.ira) qualifying += breakdown.ira;
  if (rule.applies.k401) qualifying += breakdown.k401;
  if (rule.applies.annuity) qualifying += breakdown.annuity;

  // Apply per-filer cap.
  const cap = rule.perFilerCap != null ? rule.perFilerCap * filers : Infinity;
  const amount = Math.min(qualifying, cap);
  return {
    amount,
    note: `Retirement subtraction: $${amount} of $${qualifying} qualifying (cap $${cap === Infinity ? "none" : cap}).`,
  };
}
