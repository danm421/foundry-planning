import type { ClientInfo, PlanSettings } from "../types";
import type { MonteCarloResult } from "./run";

/**
 * Linear-interpolation percentiles. Equivalent to NumPy's np.quantile with
 * method="linear" and R's quantile() type 7. For a sorted array of length n,
 * probability p maps to rank (n-1)·p; percentile is linear-interpolated
 * between the floor and ceil of that rank.
 *
 * Empty input → NaN for every probability. Single value → that value. Out-of-
 * range probabilities are clamped to the sample endpoints.
 */
export function percentiles(values: number[], probs: number[]): number[] {
  if (values.length === 0) return probs.map(() => NaN);
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return probs.map((p) => {
    if (p <= 0) return sorted[0];
    if (p >= 1) return sorted[n - 1];
    const rank = (n - 1) * p;
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sorted[lo];
    const frac = rank - lo;
    return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
  });
}

// The five percentile probabilities the report uses: p5 and p95 for the
// 90% confidence interval envelope; p20/p50/p80 for the inner "Above/Average/
// Below Market" columns in the Monte Carlo Asset Spread table.
const PROBS = [0.05, 0.2, 0.5, 0.8, 0.95] as const;

export interface PercentileBundle {
  p5: number;
  p20: number;
  p50: number;
  p80: number;
  p95: number;
}

export interface TerminalDistribution extends PercentileBundle {
  min: number;
  max: number;
  mean: number;
}

export interface YearlySummaryRow {
  year: number;
  age: { client: number; spouse?: number };
  balance: PercentileBundle & { min: number; max: number };
  /** Compound annual growth rate, annualized from plan-start starting balance
   *  to the end of this year. Null when starting balance is zero (undefined
   *  growth-from-zero). Expressed as a decimal (0.07 = 7%). */
  cagrFromStart: PercentileBundle | null;
}

export interface MonteCarloSummary {
  requestedTrials: number;
  trialsRun: number;
  aborted: boolean;
  successRate: number;
  failureRate: number;
  ending: TerminalDistribution;
  byYear: YearlySummaryRow[];
}

export interface SummarizeOptions {
  client: ClientInfo;
  planSettings: PlanSettings;
  /** Liquid portfolio assets at plan start (pre-year-0), used as the CAGR
   *  reference. Callers should compute this from ClientData — summing
   *  taxable/cash/retirement account values for in-estate holdings. */
  startingLiquidBalance: number;
}

function computePercentileBundle(values: number[]): PercentileBundle {
  const [p5, p20, p50, p80, p95] = percentiles(values, [...PROBS]);
  return { p5, p20, p50, p80, p95 };
}

function computeTerminalDistribution(values: number[]): TerminalDistribution {
  const bundle = computePercentileBundle(values);
  if (values.length === 0) {
    return { ...bundle, min: NaN, max: NaN, mean: NaN };
  }
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { ...bundle, min, max, mean: sum / values.length };
}

function parseBirthYear(dob: string | undefined): number | undefined {
  if (!dob) return undefined;
  const y = parseInt(dob.slice(0, 4), 10);
  return Number.isFinite(y) ? y : undefined;
}

export function summarizeMonteCarlo(
  result: MonteCarloResult,
  opts: SummarizeOptions,
): MonteCarloSummary {
  const { client, planSettings, startingLiquidBalance } = opts;
  const clientBirthYear = parseBirthYear(client.dateOfBirth);
  const spouseBirthYear = parseBirthYear(client.spouseDob);

  const ending = computeTerminalDistribution(result.endingLiquidAssets);

  const trialCount = result.byYearLiquidAssetsPerTrial.length;
  const yearCount = trialCount > 0 ? result.byYearLiquidAssetsPerTrial[0].length : 0;

  const byYear: YearlySummaryRow[] = [];
  for (let i = 0; i < yearCount; i++) {
    const yearValues = new Array<number>(trialCount);
    let min = Infinity, max = -Infinity;
    for (let t = 0; t < trialCount; t++) {
      const v = result.byYearLiquidAssetsPerTrial[t][i];
      yearValues[t] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const bundle = computePercentileBundle(yearValues);
    const year = planSettings.planStartYear + i;
    const yearsElapsed = i + 1;
    const age = {
      client: clientBirthYear != null ? year - clientBirthYear : 0,
      ...(spouseBirthYear != null ? { spouse: year - spouseBirthYear } : {}),
    };

    let cagrFromStart: PercentileBundle | null = null;
    if (startingLiquidBalance > 0) {
      const exp = 1 / yearsElapsed;
      const toCagr = (v: number) => Math.pow(v / startingLiquidBalance, exp) - 1;
      cagrFromStart = {
        p5: toCagr(bundle.p5),
        p20: toCagr(bundle.p20),
        p50: toCagr(bundle.p50),
        p80: toCagr(bundle.p80),
        p95: toCagr(bundle.p95),
      };
    }

    byYear.push({
      year,
      age,
      balance: { ...bundle, min, max },
      cagrFromStart,
    });
  }

  return {
    requestedTrials: result.requestedTrials,
    trialsRun: result.trialsRun,
    aborted: result.aborted,
    successRate: result.successRate,
    failureRate: 1 - result.successRate,
    ending,
    byYear,
  };
}
