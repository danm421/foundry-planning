import {
  type MonthlyReturn,
  annualizedArithmetic,
  annualizedGeometric,
  annualizedVolatility,
} from "./cma-stats";

export interface WeightedSeries {
  weight: number;
  returns: MonthlyReturn[];
}

/**
 * Blend per-ticker monthly returns into one portfolio series over the months
 * present in ALL series (monthly-rebalanced static weights). Months missing
 * from any constituent are dropped — this defines the common window.
 */
export function blendedMonthlyReturns(series: WeightedSeries[]): MonthlyReturn[] {
  if (series.length === 0) return [];
  const maps = series.map((s) => new Map(s.returns.map((r) => [r.date, r.r])));
  const common = [...maps[0].keys()]
    .filter((d) => maps.every((m) => m.has(d)))
    .sort();
  return common.map((date) => ({
    date,
    r: series.reduce((sum, s, i) => sum + s.weight * maps[i].get(date)!, 0),
  }));
}

/** Annualized downside deviation: RMS of returns below a monthly MAR. */
export function downsideDeviation(returns: number[], monthlyMar: number): number {
  if (returns.length === 0) return 0;
  const variance =
    returns.reduce((s, r) => s + Math.min(0, r - monthlyMar) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(12);
}

/** Largest peak-to-trough decline on the cumulative-growth path (0..1). */
export function maxDrawdown(returns: number[]): number {
  let peak = 1;
  let cum = 1;
  let mdd = 0;
  for (const r of returns) {
    cum *= 1 + r;
    if (cum > peak) peak = cum;
    const dd = (peak - cum) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

export interface PortfolioStats {
  annArithMean: number;
  annGeoReturn: number;
  annVolatility: number;
  downsideDeviation: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  nMonths: number;
}

/** Panel metrics from a blended monthly series + an annual risk-free rate. */
export function portfolioStats(
  blended: MonthlyReturn[],
  annualRiskFree: number,
): PortfolioStats {
  const rs = blended.map((x) => x.r);
  const monthlyRf = annualRiskFree / 12;
  const annArithMean = annualizedArithmetic(rs);
  const annVolatility = annualizedVolatility(rs);
  const dd = downsideDeviation(rs, monthlyRf);
  return {
    annArithMean,
    annGeoReturn: annualizedGeometric(rs),
    annVolatility,
    downsideDeviation: dd,
    sharpe: annVolatility === 0 ? 0 : (annArithMean - annualRiskFree) / annVolatility,
    sortino: dd === 0 ? 0 : (annArithMean - annualRiskFree) / dd,
    maxDrawdown: maxDrawdown(rs),
    nMonths: rs.length,
  };
}
