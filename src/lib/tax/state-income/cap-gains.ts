// src/lib/tax/state-income/cap-gains.ts
import type { USPSStateCode } from "@/lib/usps-states";
import { CAP_GAINS_RULES } from "./data/cap-gains-rules";
import { applyBrackets } from "./bracket-calc";

/**
 * Returns the LTCG exemption amount for states that exempt a fixed percentage
 * of long-term capital gains from state income tax (AR, MT, ND, WI).
 * Short-term gains are never exempt under this carve-out.
 * Other states return 0.
 */
export function computeCapGainsAdjustment(
  state: USPSStateCode,
  gains: { ltcg: number; stcg: number },
): number {
  const rule = CAP_GAINS_RULES[state];
  if (!rule?.ltcgExemptPct) return 0;
  return Math.max(0, gains.ltcg) * rule.ltcgExemptPct;
}

/**
 * Computes Washington's gains-only capital-gains tax: 7% on the first $1M,
 * 9% above. Negative or zero gains return 0.
 */
export function computeWaCapGainsTax(longTermGains: number): number {
  const rule = CAP_GAINS_RULES.WA;
  if (!rule?.gainsOnly) return 0;
  return applyBrackets(Math.max(0, longTermGains), rule.gainsOnly.brackets);
}
