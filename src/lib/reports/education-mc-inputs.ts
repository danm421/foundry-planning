import type { EducationGoalReport } from "./education-report-data";
import type { EducationMcInput } from "@/engine/education/education-mc";

/** Blended dedicated-pool return stats for one education goal, feeding the
 *  lognormal per-goal Monte Carlo. */
export interface EducationReturnStat {
  arithMean: number;
  stdDev: number;
}

/** Build a per-goal Monte Carlo input from the deterministic report rows.
 *
 *  contributionsByYear uses each row's `growthAndSavings`. That figure bundles
 *  growth + savings; feeding it as contributions while the MC *also* simulates
 *  returns slightly double-counts the growth slice. This is a deliberate,
 *  documented v1 approximation — the gauge is directional. A precise version
 *  needs a contributions-only figure split out of `growthAndSavings` on
 *  `EducationGoalYear` (logged as deferred future-work), not a change here.
 *
 *  withdrawalsByYear = the goal's yearly *cost* (`goalExpense`), i.e. the target
 *  the funding must cover — NOT the pool's `dedicatedWithdrawal`, which is capped
 *  at the pool balance and so would always read as fully funded. Cash-flow
 *  funding (`coveredByCashFlow`) is passed through so the gauge counts a
 *  dedicated-pool shortfall as covered rather than a failure. */
export function buildEducationMcInput(
  report: EducationGoalReport,
  stats: EducationReturnStat,
  seed: number,
): EducationMcInput {
  // Accumulation rows are display-only lead-up years; the gauge stays scoped to
  // the expense phase (its v1 growth+savings-as-contributions approximation would
  // badly amplify over a long runway). Starting balance is the first expense
  // year's BOY, exactly as before accumulation rows existed.
  const expenseRows = report.rows.filter((r) => !r.accumulation);
  return {
    startingBalance: expenseRows[0]?.dedicatedAssetsBOY ?? 0,
    contributionsByYear: expenseRows.map((r) => r.growthAndSavings),
    withdrawalsByYear: expenseRows.map((r) => r.goalExpense),
    coveredByCashFlow: report.coveredByCashFlow,
    arithMean: stats.arithMean,
    stdDev: stats.stdDev,
    seed,
    trials: 1000,
  };
}

interface ReturnStatsArgs {
  /** Education expenses drive which goals get stats; `id` is the goalId. */
  expenses: ReadonlyArray<{ id: string; type: string; dedicatedAccountIds?: string[] }>;
  /** Current balances + fixed growth rate per account (from the effective tree). */
  accounts: ReadonlyArray<{ id: string; value: number; growthRate: number }>;
  /** Base asset mix per account, resolved by the plan MC loader. */
  accountMixes: ReadonlyArray<{ accountId: string; mix: ReadonlyArray<{ assetClassId: string; weight: number }> }>;
  /** Per-asset-class arithmetic mean + std dev (the plan MC's index stats). */
  assetClassStats: ReadonlyMap<string, EducationReturnStat>;
}

/** Derive blended `{ arithMean, stdDev }` for each education goal's dedicated
 *  pool, for the client-side per-goal gauge MC.
 *
 *  Per dedicated account:
 *   - has an asset mix  → arithMean = Σ weightᵢ·classᵢ.arithMean;
 *                          stdDev   = Σ weightᵢ·classᵢ.stdDev.
 *     (A weighted mean of class std devs — directional; it ignores
 *      diversification/correlation, matching the gauge's altitude.)
 *   - fixed-rate (no mix) → arithMean = account.growthRate, stdDev = 0.
 *
 *  Then blend across the goal's accounts weighted by current balance. A goal
 *  whose dedicated accounts have zero total balance is omitted, so the panel
 *  falls back to its neutral default. Pure — safe to call server-side. */
export function buildEducationReturnStats(args: ReturnStatsArgs): Record<string, EducationReturnStat> {
  const acctById = new Map(args.accounts.map((a) => [a.id, a]));
  const mixByAccount = new Map(args.accountMixes.map((m) => [m.accountId, m.mix]));
  const out: Record<string, EducationReturnStat> = {};

  for (const e of args.expenses) {
    if (e.type !== "education") continue;
    const ids = e.dedicatedAccountIds ?? [];
    if (ids.length === 0) continue;

    let totalBalance = 0;
    let weightedArith = 0;
    let weightedStd = 0;
    for (const id of ids) {
      const acct = acctById.get(id);
      if (!acct) continue;
      const balance = Math.max(0, acct.value);
      if (balance <= 0) continue;

      const mix = mixByAccount.get(id);
      let arith: number;
      let std: number;
      if (mix && mix.length > 0) {
        arith = 0;
        std = 0;
        for (const m of mix) {
          const s = args.assetClassStats.get(m.assetClassId);
          if (!s) continue;
          arith += m.weight * s.arithMean;
          std += m.weight * s.stdDev;
        }
      } else {
        arith = acct.growthRate;
        std = 0;
      }
      weightedArith += balance * arith;
      weightedStd += balance * std;
      totalBalance += balance;
    }

    if (totalBalance > 0) {
      out[e.id] = { arithMean: weightedArith / totalBalance, stdDev: weightedStd / totalBalance };
    }
  }

  return out;
}
