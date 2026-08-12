import type { BreakEvenResult } from "./types";

/** Past this, a recovery estimate is not a useful number to put in front of a client. */
export const MAX_BREAK_EVEN_YEARS = 25;

export interface ComputeBreakEvenInput {
  estimatedTax: number;
  totalValue: number;
  /** proposed − current expected geometric return. */
  returnDelta: number;
  /** current − proposed all-in fee rate; null when fee data is unusable. */
  feeSavingRate: number | null;
}

/**
 * How long the tax cost of switching takes to earn back.
 *
 * An expectation, not a promise — the copy around it must say so. The guards
 * matter more than the arithmetic: a proposal that does not beat its own fees
 * has no break-even at all, and printing a negative or infinite year count
 * there is worse than saying so plainly.
 */
export function computeBreakEven(input: ComputeBreakEvenInput): BreakEvenResult {
  const annualBenefit = input.totalValue * (input.returnDelta + (input.feeSavingRate ?? 0));

  if (input.estimatedTax <= 0) {
    return { estimatedTax: input.estimatedTax, annualBenefit, years: null, verdict: "no_tax_cost" };
  }
  if (annualBenefit <= 0) {
    return { estimatedTax: input.estimatedTax, annualBenefit, years: null, verdict: "no_benefit" };
  }

  const years = input.estimatedTax / annualBenefit;
  return {
    estimatedTax: input.estimatedTax,
    annualBenefit,
    years,
    verdict: years > MAX_BREAK_EVEN_YEARS ? "beyond_horizon" : "recovered",
  };
}
