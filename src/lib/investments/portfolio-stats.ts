import type { AssetClassData } from "@/lib/portfolio-math";
import type { AssetClassWeight } from "./benchmarks";
import { buildCorrelationMatrix, type CorrelationRow } from "@/engine/monteCarlo/correlation-matrix";

export interface RiskReturnStats {
  arithmeticMean: number;
  geometricReturn: number;
  stdDev: number;
  /** null when stdDev === 0 (Sharpe undefined). */
  sharpe: number | null;
}

export interface StatsContext {
  ids: string[];
  indexOf: Map<string, number>;
  mean: number[];
  vol: number[];
  /** Per-class geometric returns, for the naive (eMoney-parity) return blend. */
  geo: number[];
  corr: number[][];
  riskFreeRate: number;
}

export function buildStatsContext(
  assetClasses: AssetClassData[],
  correlationRows: CorrelationRow[],
  riskFreeRate: number,
): StatsContext {
  const ids = assetClasses.map((c) => c.id);
  const indexOf = new Map<string, number>();
  ids.forEach((id, i) => indexOf.set(id, i));
  return {
    ids,
    indexOf,
    mean: assetClasses.map((c) => c.arithmeticMean),
    vol: assetClasses.map((c) => c.volatility),
    geo: assetClasses.map((c) => c.geometricReturn),
    corr: buildCorrelationMatrix(ids, correlationRows),
    riskFreeRate,
  };
}

/**
 * Mean and geometric return are linear in weights (matches eMoney and the
 * projection engine: the headline return gets no diversification credit).
 * Volatility uses Σᵢⱼ = σᵢσⱼρᵢⱼ, so std dev IS diversification-aware.
 */
export function computeStats(weights: AssetClassWeight[], ctx: StatsContext): RiskReturnStats {
  const present = weights
    .map((w) => ({ idx: ctx.indexOf.get(w.assetClassId), weight: w.weight }))
    .filter((w): w is { idx: number; weight: number } => w.idx !== undefined);

  let mean = 0;
  let geometricReturn = 0;
  for (const w of present) {
    mean += w.weight * ctx.mean[w.idx]!;
    geometricReturn += w.weight * ctx.geo[w.idx]!;
  }

  let variance = 0;
  for (const a of present) {
    for (const b of present) {
      variance += a.weight * b.weight * ctx.vol[a.idx]! * ctx.vol[b.idx]! * ctx.corr[a.idx]![b.idx]!;
    }
  }
  const stdDev = Math.sqrt(Math.max(0, variance));
  const sharpe = stdDev > 0 ? (mean - ctx.riskFreeRate) / stdDev : null;

  return { arithmeticMean: mean, geometricReturn, stdDev, sharpe };
}
