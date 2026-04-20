import { cholesky } from "./cholesky";
import { arithToLogParams, rateFromLogReturn } from "./lognormal";
import { createRng, splitSeed } from "./prng";
import { createNormalSampler } from "./normal";

export interface IndexInput {
  /** Stable identifier — typically the asset_class row id in production. */
  id: string;
  arithMean: number;
  stdDev: number;
}

export interface ReturnEngineInput {
  indices: IndexInput[];
  /** Symmetric matrix, 1s on diagonal, ordered the same as `indices`. */
  correlation: number[][];
  seed: number;
  /** Per eMoney whitepaper p.6: arithmetic returns cap at [-1.0, 2.0]. */
  rateCap?: { min: number; max: number };
}

export interface TrialStream {
  /** Produce one year's arithmetic rate vector, in the same order as `indices`. */
  nextYear(): number[];
}

export interface ReturnEngine {
  /** Asset-class ids in the order they appear in every returned rate vector. */
  indices: string[];
  /** Start an independent (but deterministic-by-seed) trial stream. */
  startTrial(trialIndex: number): TrialStream;
}

const DEFAULT_CAP = { min: -1.0, max: 2.0 } as const;

/**
 * Pure-math transform: given the Cholesky decomposition L of the log-space
 * covariance matrix, the log-space means μ, and a standard-normal vector Z,
 * produce the per-index arithmetic rate vector with caps applied.
 *
 *   X = L · Z       (correlated log-space innovation)
 *   Y = X + μ       (log-space returns with correct drift)
 *   r = exp(Y) - 1  (arithmetic rates, then clamp to [min, max])
 */
export function transformReturns(
  L: number[][],
  mu: number[],
  Z: number[],
  rateCap: { min: number; max: number } = DEFAULT_CAP,
): number[] {
  const n = mu.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    // L is lower-triangular, so only k ≤ i contribute.
    for (let k = 0; k <= i; k++) x += L[i][k] * Z[k];
    const y = x + mu[i];
    const r = rateFromLogReturn(y);
    out[i] = r < rateCap.min ? rateCap.min : r > rateCap.max ? rateCap.max : r;
  }
  return out;
}

/** Build covariance from log-space σ and the correlation matrix. */
function buildCovariance(sigma: number[], correlation: number[][]): number[][] {
  const n = sigma.length;
  const cov: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = correlation[i][j] * sigma[i] * sigma[j];
    }
  }
  return cov;
}

export function createReturnEngine(input: ReturnEngineInput): ReturnEngine {
  const { indices, correlation, seed } = input;
  const rateCap = input.rateCap ?? DEFAULT_CAP;
  const n = indices.length;

  if (correlation.length !== n) {
    throw new Error(
      `createReturnEngine: correlation matrix has ${correlation.length} rows, expected ${n}`,
    );
  }
  for (const row of correlation) {
    if (row.length !== n) {
      throw new Error(
        `createReturnEngine: correlation matrix is not ${n}×${n}`,
      );
    }
  }

  // One-time setup: lognormal params → covariance → Cholesky. All trials reuse these.
  const mu = new Array<number>(n);
  const sigma = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const p = arithToLogParams(indices[i].arithMean, indices[i].stdDev);
    mu[i] = p.mu;
    sigma[i] = p.sigma;
  }
  const cov = buildCovariance(sigma, correlation);
  const L = cholesky(cov);
  const ids = indices.map((ix) => ix.id);

  return {
    indices: ids,
    startTrial(trialIndex: number): TrialStream {
      const rng = createRng(splitSeed(seed, trialIndex));
      const normal = createNormalSampler(rng);
      return {
        nextYear(): number[] {
          const Z = new Array<number>(n);
          for (let i = 0; i < n; i++) Z[i] = normal();
          return transformReturns(L, mu, Z, rateCap);
        },
      };
    },
  };
}
