// Pure, framework-free summary of a deterministic retirement projection.
// Uses the engine's own liquid-assets definition + success gate (see
// monteCarlo/trial.ts) so deterministic "funded" matches the MC "funded"
// definition exactly.
import type { ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";

export interface RetirementSummary {
  /** Liquid portfolio at end of plan. Negative = cumulative unmet need. */
  assetsRemaining: number;
  /** Ages in the last year before liquid first goes negative. null if funded
   *  through end of plan. spouse is null for single-client plans. */
  ageAssetsLastUntil: { client: number; spouse: number | null } | null;
  /** Count of years with liquid assets >= 0. */
  yearsFullyFunded: number;
  /** Mean expense-coverage ratio across partially-funded years (liquid < 0),
   *  in [0,1]. null when there are none. */
  avgPercentFunded: number | null;
  /** True when liquid assets never go negative through end of plan. */
  fullyFunded: boolean;
}

export function deriveRetirementSummary(years: ProjectionYear[]): RetirementSummary {
  if (years.length === 0) {
    return {
      assetsRemaining: 0,
      ageAssetsLastUntil: null,
      yearsFullyFunded: 0,
      avgPercentFunded: null,
      fullyFunded: true,
    };
  }

  const liquids = years.map((y) => liquidPortfolioTotal(y));
  const firstShortIdx = liquids.findIndex((v) => v < 0);
  const fullyFunded = firstShortIdx === -1;

  const last = years[years.length - 1];
  const assetsRemaining = liquidPortfolioTotal(last);
  const yearsFullyFunded = liquids.filter((v) => v >= 0).length;

  let ageAssetsLastUntil: RetirementSummary["ageAssetsLastUntil"] = null;
  if (!fullyFunded) {
    // The last funded year is the one immediately before the first short year.
    const lastFundedYear = years[Math.max(0, firstShortIdx - 1)];
    ageAssetsLastUntil = {
      client: lastFundedYear.ages.client,
      spouse: lastFundedYear.ages.spouse ?? null,
    };
  }

  const partialRatios = years
    .filter((_, i) => liquids[i] < 0)
    .map((y) =>
      y.totalExpenses > 0
        ? Math.max(0, Math.min(1, (y.income.total + y.withdrawals.total) / y.totalExpenses))
        : 1,
    );
  const avgPercentFunded =
    partialRatios.length > 0
      ? partialRatios.reduce((a, b) => a + b, 0) / partialRatios.length
      : null;

  return { assetsRemaining, ageAssetsLastUntil, yearsFullyFunded, avgPercentFunded, fullyFunded };
}
