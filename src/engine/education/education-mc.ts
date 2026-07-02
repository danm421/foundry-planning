/** Self-contained per-goal Monte Carlo: simulate the dedicated pool's stochastic
 *  balance path (lognormal returns, same primitives as the plan MC) minus the
 *  goal's withdrawal schedule, and report the fraction of trials that fully fund
 *  the goal. Framework-free; ignores general-spending draws on the pool (a
 *  documented v1 simplification — education goals are typically pre-retirement).
 */
import { createRng, splitSeed } from "../monteCarlo/prng";
import { createNormalSampler } from "../monteCarlo/normal";
import { arithToLogParams, rateFromLogReturn } from "../monteCarlo/lognormal";

const RATE_CAP = { min: -1.0, max: 2.0 } as const;

export interface EducationMcInput {
  startingBalance: number;
  contributionsByYear: readonly number[];
  withdrawalsByYear: readonly number[];
  arithMean: number;
  stdDev: number;
  seed: number;
  trials?: number;
}

export function runEducationGoalMc(input: EducationMcInput): { successRate: number; trials: number } {
  const { startingBalance, contributionsByYear, withdrawalsByYear, arithMean, stdDev, seed } = input;
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
      const w = withdrawalsByYear[y] ?? 0;
      if (w > balance + 1e-6) { funded = false; break; }
      balance -= w;
    }
    if (funded) successes++;
  }
  return { successRate: trials === 0 ? 0 : successes / trials, trials };
}
