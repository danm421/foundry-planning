/** Self-contained per-goal Monte Carlo: simulate the dedicated pool's stochastic
 *  balance path (lognormal returns, same primitives as the plan MC) against the
 *  goal's yearly cost, and report the fraction of trials that fully fund the
 *  goal. Each year's `withdrawalsByYear` entry is the goal's *cost* (the target
 *  to cover), not the pool's capped draw — a trial fails the year the pool can't
 *  meet the cost, unless `coveredByCashFlow` is set (the goal's
 *  `payShortfallOutOfPocket` funding), in which case household cash flow covers
 *  the gap and the trial keeps going. Framework-free; ignores general-spending
 *  draws on the pool (a documented v1 simplification — education goals are
 *  typically pre-retirement).
 */
import { createRng, splitSeed } from "../monteCarlo/prng";
import { createNormalSampler } from "../monteCarlo/normal";
import { arithToLogParams, rateFromLogReturn } from "../monteCarlo/lognormal";

const RATE_CAP = { min: -1.0, max: 2.0 } as const;

export interface EducationMcInput {
  startingBalance: number;
  contributionsByYear: readonly number[];
  /** Per-year goal cost the pool must cover (the target, not the capped draw). */
  withdrawalsByYear: readonly number[];
  /** When true, a year the pool can't fully cover is met from household cash flow
   *  (the goal's `payShortfallOutOfPocket`) instead of failing the trial. */
  coveredByCashFlow?: boolean;
  arithMean: number;
  stdDev: number;
  seed: number;
  trials?: number;
}

export function runEducationGoalMc(input: EducationMcInput): { successRate: number; trials: number } {
  const { startingBalance, contributionsByYear, withdrawalsByYear, coveredByCashFlow, arithMean, stdDev, seed } = input;
  const trials = input.trials ?? 1000;
  const nYears = Math.max(contributionsByYear.length, withdrawalsByYear.length);
  const { mu, sigma } = arithToLogParams(arithMean, stdDev);

  let successes = 0;
  for (let t = 0; t < trials; t++) {
    const normal = createNormalSampler(createRng(splitSeed(seed, t)));
    let balance = startingBalance;
    let funded = true;
    for (let y = 0; y < nYears; y++) {
      balance += contributionsByYear[y] ?? 0;
      const z = normal();
      let r = rateFromLogReturn(sigma * z + mu);
      r = r < RATE_CAP.min ? RATE_CAP.min : r > RATE_CAP.max ? RATE_CAP.max : r;
      balance *= 1 + r;
      const cost = withdrawalsByYear[y] ?? 0;
      if (cost > balance + 1e-6) {
        // Pool can't cover this year's cost. Cash-flow-funded goals draw the pool
        // dry and cover the gap out of pocket; otherwise the goal is underfunded.
        if (!coveredByCashFlow) { funded = false; break; }
        balance = 0;
      } else {
        balance -= cost;
      }
    }
    if (funded) successes++;
  }
  return { successRate: trials === 0 ? 0 : successes / trials, trials };
}
