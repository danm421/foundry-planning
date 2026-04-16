import type { BracketTier } from "./types";

/**
 * Calculate federal income tax via progressive bracket walk.
 * Returns 0 for zero or negative income.
 */
export function calcFederalTax(taxableBase: number, brackets: BracketTier[]): number {
  if (taxableBase <= 0) return 0;
  let tax = 0;
  for (const tier of brackets) {
    if (taxableBase <= tier.from) break;
    const top = tier.to ?? Infinity;
    const span = Math.min(taxableBase, top) - tier.from;
    tax += span * tier.rate;
    if (taxableBase <= top) break;
  }
  return tax;
}

/**
 * Marginal rate at a given income level. Income exactly at a boundary
 * belongs to the upper bracket (next dollar's rate).
 */
export function calcMarginalRate(taxableBase: number, brackets: BracketTier[]): number {
  if (taxableBase < 0) return 0;
  for (const tier of brackets) {
    const top = tier.to ?? Infinity;
    if (taxableBase < top) return tier.rate;
  }
  return brackets[brackets.length - 1].rate;
}
