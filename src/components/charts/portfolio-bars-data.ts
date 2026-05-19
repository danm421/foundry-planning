import type { ProjectionYear } from "@/engine";

/**
 * Liquid portfolio total for cash-flow framing: taxable + cash + retirement
 * + life insurance cash value. Excludes real estate and business assets —
 * advisors think of cash flow against the investable portfolio, not the
 * household's outside-the-estate holdings.
 */
export function liquidPortfolioTotal(y: ProjectionYear): number {
  return (
    y.portfolioAssets.taxableTotal +
    y.portfolioAssets.cashTotal +
    y.portfolioAssets.retirementTotal +
    y.portfolioAssets.lifeInsuranceTotal
  );
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
    const base = baseLiquidByYear.get(y.year) ?? scenario;

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
