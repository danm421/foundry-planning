/** Self-contained per-goal Monte Carlo: simulate the dedicated pool's stochastic
 *  balance path (lognormal returns, same primitives as the plan MC) against the
 *  goal's yearly cost, and report the fraction of trials that fully fund the
 *  goal. Each year's `withdrawalsByYear` entry is the goal's *cost* (the target
 *  to cover), not the pool's capped draw. A trial fails the first year the pool
 *  can't meet the cost. Cash flow is the goal's backstop, not part of this
 *  measure — the gauge answers "will the savings cover it" (spec 2026-10-05,
 *  Decision 7). Framework-free; ignores general-spending draws on the pool (a
 *  documented v1 simplification). Education goals are typically
 *  pre-retirement, but an Other goal can draw a household brokerage the
 *  withdrawal strategy also draws, and then the gauge may overstate confidence.
 */
import { createRng, splitSeed } from "../monteCarlo/prng";
import { createNormalSampler } from "../monteCarlo/normal";
import { arithToLogParams, rateFromLogReturn } from "../monteCarlo/lognormal";

const RATE_CAP = { min: -1.0, max: 2.0 } as const;

export interface GoalMcInput {
  startingBalance: number;
  contributionsByYear: readonly number[];
  /** Per-year goal cost the pool must cover (the target, not the capped draw). */
  withdrawalsByYear: readonly number[];
  arithMean: number;
  stdDev: number;
  seed: number;
  trials?: number;
}

export function runGoalMc(input: GoalMcInput): { successRate: number; trials: number } {
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
      const cost = withdrawalsByYear[y] ?? 0;
      if (cost > balance + 1e-6) { funded = false; break; }
      balance -= cost;
    }
    if (funded) successes++;
  }
  return { successRate: trials === 0 ? 0 : successes / trials, trials };
}
