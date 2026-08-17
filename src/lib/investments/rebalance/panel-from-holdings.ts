import type { MonthlyReturn } from "@/lib/cma-stats";
import type { PortfolioHoldingSeries } from "@/lib/ticker-portfolio-service";

/**
 * Below this share of a side's value carrying price history, the realized
 * block is withheld entirely. Mirrors `FEE_COVERAGE_MIN` — the fee blend
 * already refuses to speak for a portfolio it can only half see, and a
 * backtest has exactly the same problem.
 *
 * Lives here rather than in `assemble.ts` because this is the module that
 * computes `coveragePct`, and because the client bundle imports the threshold
 * for its warning copy — it should not have to pull the whole assembler in.
 */
export const REALIZED_COVERAGE_MIN = 0.5;

/** Above the floor but below this, the UI prints the coverage figure alongside
 *  the stats. Mirrors `FEE_COVERAGE_WARN`. */
export const REALIZED_COVERAGE_WARN = 0.8;

export interface HoldingForSeries {
  securityId: string | null;
  ticker: string; // displayTicker or fallback label
  marketValue: number;
}

export interface BuildSeriesResult {
  series: PortfolioHoldingSeries[]; // covered securities only, weights sum to 1
  coveredValue: number;
  totalValue: number;
  coveragePct: number; // coveredValue / totalValue (0 when totalValue is 0)
  uncoveredTickers: string[];
}

export function buildHoldingSeries(
  holdings: readonly HoldingForSeries[],
  returnsBySecurity: ReadonlyMap<string, MonthlyReturn[]>,
): BuildSeriesResult {
  const totalValue = holdings.reduce((s, h) => s + h.marketValue, 0);

  const valueBySecurity = new Map<string, { ticker: string; value: number }>();
  const uncoveredTickers: string[] = [];

  for (const h of holdings) {
    const returns = h.securityId ? returnsBySecurity.get(h.securityId) : undefined;
    if (!h.securityId || !returns || returns.length === 0) {
      uncoveredTickers.push(h.ticker);
      continue;
    }
    const prev = valueBySecurity.get(h.securityId);
    if (prev) prev.value += h.marketValue;
    else valueBySecurity.set(h.securityId, { ticker: h.ticker, value: h.marketValue });
  }

  const coveredValue = [...valueBySecurity.values()].reduce((s, v) => s + v.value, 0);

  const series: PortfolioHoldingSeries[] =
    coveredValue === 0
      ? []
      : [...valueBySecurity.entries()].map(([securityId, v]) => ({
          ticker: v.ticker,
          weight: v.value / coveredValue,
          returns: returnsBySecurity.get(securityId)!,
        }));

  return {
    series,
    coveredValue,
    totalValue,
    coveragePct: totalValue === 0 ? 0 : coveredValue / totalValue,
    uncoveredTickers,
  };
}
