import type { BracketTier, FilingStatus, TaxYearParameters } from "@/lib/tax/types";
import type { ProjectionYear } from "@/engine";

export interface BracketFillSegment {
  rate: number;
  amount: number;
}

/**
 * Slice a year's `incomeTaxBase` across an ordinary-bracket schedule, bottom-up.
 * Returns one segment per bracket tier that received income. The top tier is
 * open-ended (`to === null`) and absorbs all remaining income.
 */
export function sliceIntoBrackets(
  incomeTaxBase: number,
  brackets: BracketTier[],
): BracketFillSegment[] {
  if (!(incomeTaxBase > 0)) return [];
  const out: BracketFillSegment[] = [];
  let remaining = incomeTaxBase;
  for (const tier of brackets) {
    if (remaining <= 0) break;
    const cap = tier.to ?? Infinity;
    const width = Math.max(0, cap - tier.from);
    const slice = Math.min(remaining, width);
    if (slice > 0) {
      out.push({ rate: tier.rate, amount: slice });
      remaining -= slice;
    }
  }
  return out;
}

const FILING_STATUSES: FilingStatus[] = [
  "married_joint",
  "single",
  "head_of_household",
  "married_separate",
];

/**
 * Identify which filing-status ordinary-bracket array contains the engine's
 * `marginalBracketTier` for the year. Robust to filing-status flips at death.
 * Defensive fallback to MFJ when no match (only possible if the engine emitted
 * a tier outside the seeded schedules).
 */
export function inferOrdinaryBrackets(
  marginal: BracketTier,
  params: TaxYearParameters,
): BracketTier[] {
  for (const fs of FILING_STATUSES) {
    const arr = params.incomeBrackets[fs];
    if (!arr) continue;
    if (
      arr.some(
        (t) => t.from === marginal.from && t.to === marginal.to && t.rate === marginal.rate,
      )
    ) {
      return arr;
    }
  }
  return params.incomeBrackets.married_joint;
}

/**
 * For each ordinary-bracket rate (excluding the open-ended top tier), return a
 * year-aligned series of bracket-top dollar amounts. Years without a taxResult
 * yield NaN so Chart.js can render a gap.
 */
export function bracketTopsByYear(years: ProjectionYear[]): Map<number, number[]> {
  const ratesSeen = new Set<number>();
  const perYear: Array<Map<number, number>> = years.map((y) => {
    const tr = y.taxResult;
    if (!tr) return new Map();
    const brackets = inferOrdinaryBrackets(tr.diag.marginalBracketTier, tr.diag.bracketsUsed);
    const m = new Map<number, number>();
    for (const tier of brackets) {
      if (tier.to == null) continue;
      m.set(tier.rate, tier.to);
      ratesSeen.add(tier.rate);
    }
    return m;
  });
  const out = new Map<number, number[]>();
  for (const rate of ratesSeen) {
    out.set(
      rate,
      perYear.map((m) => (m.has(rate) ? (m.get(rate) as number) : NaN)),
    );
  }
  return out;
}
