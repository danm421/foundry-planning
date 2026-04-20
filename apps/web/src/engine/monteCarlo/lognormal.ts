/**
 * Lognormal parameter conversions matching the eMoney Monte Carlo whitepaper.
 *
 * Stock returns are lognormally distributed, so the Monte Carlo simulates in
 * log-space (where draws are normal) and converts back via exp(y) - 1.
 */

export interface LogParams {
  /** v = stdDev² (arithmetic variance). */
  variance: number;
  /** m² = (1 + arithMean)². */
  meanSquared: number;
  /** lnvar = ln(1 + v / m²) — variance in log-space. */
  lnVariance: number;
  /** μ = ½ · ln(m⁴ / (m² + v)) — mean in log-space. */
  mu: number;
  /** σ = √lnvar — stdev in log-space. */
  sigma: number;
}

/**
 * Convert arithmetic mean + standard deviation into lognormal (log-space) params.
 * Formulas are from the eMoney whitepaper p.8, step 2.
 */
export function arithToLogParams(arithMean: number, stdDev: number): LogParams {
  const variance = stdDev * stdDev;
  const onePlusMean = 1 + arithMean;
  const meanSquared = onePlusMean * onePlusMean;
  const lnVariance = Math.log(1 + variance / meanSquared);
  // ½ · ln(m⁴ / (m² + v)) — factored to avoid recomputing m².
  const mu = 0.5 * Math.log((meanSquared * meanSquared) / (meanSquared + variance));
  const sigma = Math.sqrt(lnVariance);
  return { variance, meanSquared, lnVariance, mu, sigma };
}

/** Convert a log-space return y back to an arithmetic rate: r = exp(y) - 1. */
export function rateFromLogReturn(y: number): number {
  return Math.exp(y) - 1;
}
