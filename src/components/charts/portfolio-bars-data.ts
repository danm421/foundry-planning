import type { ProjectionYear } from "@/engine";

/**
 * Canonical liquid portfolio total for cash-flow framing — the single source of
 * truth shared by the chart bar, the summary cell, and the next-year BoY (H1).
 * = taxable + cash + retirement + life insurance + accessible trust assets
 * (engine `portfolioAssets.liquidTotal`). Excludes real estate, business, and
 * locked trusts — advisors frame cash flow against the investable portfolio,
 * not the household's outside-the-estate / net-worth holdings.
 */
export function liquidPortfolioTotal(y: ProjectionYear): number {
  return y.portfolioAssets.liquidTotal;
}

/**
 * Stacked-bar segment values for the Portfolio Assets chart in scenario
 * (delta) mode. Chart.js stacks positive and negative values separately from
 * zero, so a positive cap cannot stack onto a negative floor — it would draw
 * from zero upward and overshoot. To avoid that, each side (scenario, base) is
 * clamped to 0 for the segment math: an underwater side renders flat while the
 * still-solvent side keeps its full-height bar. `scenarioTotals` keeps the raw
 * value (negatives included) so the tooltip can still surface the real number.
 */
export interface PortfolioDeltaSegments {
  /** Blue floor — the amount common to scenario and base. */
  floor: number[];
  /** Green cap — how far the scenario runs ahead of the base case. */
  scenarioAhead: number[];
  /** Gray cap — how far the base case runs ahead of the scenario. */
  baseAhead: number[];
  /** Raw scenario liquid total per year, negatives included (tooltip source). */
  scenarioTotals: number[];
}

export function buildPortfolioDeltaSegments(
  current: ProjectionYear[],
  baseLiquidByYear: Map<number, number>,
): PortfolioDeltaSegments {
  const floor: number[] = [];
  const scenarioAhead: number[] = [];
  const baseAhead: number[] = [];
  const scenarioTotals: number[] = [];

  for (const y of current) {
    const scenario = liquidPortfolioTotal(y);
    scenarioTotals.push(scenario);
    // A scenario year with no base counterpart means the base projection ended
    // earlier — its household is fully deceased by then (a genuinely shorter-
    // lived base), or the two horizons briefly disagree. Treat the absent base
    // as $0 so the bar renders as "scenario fully ahead" (green) rather than the
    // misleading "identical to base" (all-blue floor) that a `?? scenario`
    // fallback drew. Matches the sibling estate trajectory chart's `?? 0`
    // convention. (Horizon staleness is separately reconciled before projecting
    // — see applyLifeExpectancyHorizon — so this normally only fires when a
    // scenario legitimately outlives the base case.)
    const base = baseLiquidByYear.get(y.year) ?? 0;

    // Clamp each side to 0: an underwater side contributes a flat bar, the
    // solvent side still renders its full projection.
    const eff = Math.max(0, scenario);
    const effBase = Math.max(0, base);
    floor.push(Math.min(eff, effBase));
    scenarioAhead.push(Math.max(0, eff - effBase));
    baseAhead.push(Math.max(0, effBase - eff));
  }

  return { floor, scenarioAhead, baseAhead, scenarioTotals };
}

/**
 * Single-series values for the Portfolio Assets chart in base (non-delta)
 * mode. Negative totals render flat (0); `scenarioTotals` keeps the raw value
 * so the tooltip can show the real negative number on hover.
 */
export interface PortfolioSingleSeries {
  data: number[];
  scenarioTotals: number[];
}

export function buildPortfolioSingleSeries(
  years: ProjectionYear[],
): PortfolioSingleSeries {
  const data: number[] = [];
  const scenarioTotals: number[] = [];
  for (const y of years) {
    const total = liquidPortfolioTotal(y);
    scenarioTotals.push(total);
    data.push(total < 0 ? 0 : total);
  }
  return { data, scenarioTotals };
}
