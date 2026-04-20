import type { ProjectionYear } from "@/engine";
import type { SeriesPoint } from "./timeline-types";

/**
 * Derive the three sparkline series from projection output.
 *
 * netWorth = gross assets (portfolioAssets.total) − end-of-year liability balance.
 * portfolio = investable assets only (taxable + cash + retirement totals).
 * netCashFlow = ProjectionYear.netCashFlow.
 *
 * For end-of-year liability balance we use next year's BoY balance when available;
 * for the final year we fall back to current-year BoY minus the year's principal
 * paydown (expenses.liabilities − interest). This is an approximation consistent
 * with how the UI treats "end of year" elsewhere.
 */
export function buildSeries(projection: ProjectionYear[]): SeriesPoint[] {
  return projection.map((py, i) => {
    const nextBoY = projection[i + 1]?.liabilityBalancesBoY ?? null;
    let liabEoY: number;
    if (nextBoY) {
      liabEoY = Object.values(nextBoY).reduce((s, v) => s + v, 0);
    } else {
      const boy = Object.values(py.liabilityBalancesBoY).reduce((s, v) => s + v, 0);
      const interest = Object.values(py.expenses.interestByLiability).reduce((s, v) => s + v, 0);
      const principal = py.expenses.liabilities - interest;
      liabEoY = Math.max(0, boy - principal);
    }

    const portfolio =
      py.portfolioAssets.taxableTotal +
      py.portfolioAssets.cashTotal +
      py.portfolioAssets.retirementTotal;

    return {
      year: py.year,
      netWorth: py.portfolioAssets.total - liabEoY,
      portfolio,
      netCashFlow: py.netCashFlow,
    };
  });
}
