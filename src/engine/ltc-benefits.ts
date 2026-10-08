// src/engine/ltc-benefits.ts
//
// Long-term care policy math. Pure and framework-free.
//
// Part 1 holds the two formulas the Insurance page's read-back line shares
// with the payout engine; Part 2 adds `synthesizeLtcBenefits` here. One copy of
// each formula, so the screen and the projection cannot drift.
import type { LtcPolicy } from "./types";

/** The inflation rider's growth factor for `year`, measured from the ISSUE
 *  year (not the claim year). 1 in or before the issue year. */
export function ltcInflationFactor(
  p: Pick<LtcPolicy, "inflationRider" | "inflationRate" | "issueYear">,
  year: number,
): number {
  const n = Math.max(0, year - p.issueYear);
  if (p.inflationRider === "simple") return 1 + p.inflationRate * n;
  if (p.inflationRider === "compound") return (1 + p.inflationRate) ** n;
  return 1;
}

/** A benefit as a monthly figure: a daily benefit pays day × 365 / 12. */
export function ltcMonthlyFromUnit(amount: number, unit: LtcPolicy["benefitUnit"]): number {
  return unit === "day" ? (amount * 365) / 12 : amount;
}
