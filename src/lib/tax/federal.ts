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

/**
 * Find the marginal bracket tier the next dollar of income lands in.
 * Mirrors `calcMarginalRate`'s boundary rule: income exactly at a tier's
 * upper bound belongs to the upper bracket. Negative or zero base returns
 * the first tier. Returns `null` only when `brackets` is empty.
 */
export function findMarginalTier(
  taxableBase: number,
  brackets: BracketTier[],
): BracketTier | null {
  if (brackets.length === 0) return null;
  if (taxableBase < 0) return brackets[0];
  for (const tier of brackets) {
    const top = tier.to ?? Infinity;
    if (taxableBase < top) return tier;
  }
  return brackets[brackets.length - 1];
}
