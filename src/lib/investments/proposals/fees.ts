import type { FeeComparison, FeeHolding } from "./types";

/** Below this share of value with a known ratio, we report no blend at all. */
export const FEE_COVERAGE_MIN = 0.5;
/** Below this, the report prints the coverage figure alongside the blend. */
export const FEE_COVERAGE_WARN = 0.8;

/**
 * Value-weighted mean expense ratio over the holdings that have one,
 * renormalized to that subset. Holdings with an unknown ratio are excluded
 * from the mean and subtracted from coverage — never counted as zero, which
 * would drag the blend down and invent a saving.
 */
export function blendExpenseRatio(holdings: readonly FeeHolding[]): {
  blended: number | null;
  coveragePct: number;
} {
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);
  if (total <= 0) return { blended: null, coveragePct: 0 };

  const known = holdings.filter((h) => h.expenseRatio != null);
  const knownValue = known.reduce((s, h) => s + h.marketValue, 0);
  if (knownValue <= 0) return { blended: null, coveragePct: 0 };

  const weighted = known.reduce((s, h) => s + h.marketValue * (h.expenseRatio ?? 0), 0);
  return { blended: weighted / knownValue, coveragePct: knownValue / total };
}

export interface BuildFeeComparisonInput {
  totalValue: number;
  currentHoldings: readonly FeeHolding[];
  proposedHoldings: readonly FeeHolding[];
  advisoryFeeCurrent: number | null;
  advisoryFeeProposed: number | null;
}

export function buildFeeComparison(input: BuildFeeComparisonInput): FeeComparison {
  const cur = blendExpenseRatio(input.currentHoldings);
  const prop = blendExpenseRatio(input.proposedHoldings);

  const curEr = cur.coveragePct >= FEE_COVERAGE_MIN ? cur.blended : null;
  const propEr = prop.coveragePct >= FEE_COVERAGE_MIN ? prop.blended : null;

  const allIn = (er: number | null, advisory: number | null): number | null =>
    er == null ? null : (er + (advisory ?? 0)) * input.totalValue;

  const annualDollarsCurrent = allIn(curEr, input.advisoryFeeCurrent);
  const annualDollarsProposed = allIn(propEr, input.advisoryFeeProposed);

  return {
    currentBlendedEr: curEr,
    proposedBlendedEr: propEr,
    currentCoveragePct: cur.coveragePct,
    proposedCoveragePct: prop.coveragePct,
    advisoryFeeCurrent: input.advisoryFeeCurrent,
    advisoryFeeProposed: input.advisoryFeeProposed,
    annualDollarsCurrent,
    annualDollarsProposed,
    annualDollarsSaved:
      annualDollarsCurrent == null || annualDollarsProposed == null
        ? null
        : annualDollarsCurrent - annualDollarsProposed,
  };
}
