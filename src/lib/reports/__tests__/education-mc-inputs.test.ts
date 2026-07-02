import { describe, it, expect } from "vitest";
import { buildEducationMcInput, buildEducationReturnStats } from "../education-mc-inputs";
import type { EducationGoalReport } from "../education-report-data";

const report = {
  goalId: "edu", name: "College", dedicatedFundsUsed: 30000, cashFlowFundsUsed: 0, totalShortfall: 10000,
  chart: { labels: [], remaining: [], withdrawals: [], outOfPocket: [], shortfall: [] },
  rows: [
    { goalId: "edu", year: 2026, dedicatedAssetsBOY: 30000, growthAndSavings: 1800, goalExpense: 0, otherExpenseFlows: 0, dedicatedWithdrawal: 0, outOfPocketWithdrawal: 0, dedicatedAssetsEOY: 31800, shortfall: 0 },
    { goalId: "edu", year: 2033, dedicatedAssetsBOY: 40000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 30000, outOfPocketWithdrawal: 0, dedicatedAssetsEOY: 0, shortfall: 10000 },
  ],
} as EducationGoalReport;

describe("buildEducationMcInput", () => {
  it("uses BOY of the first row as starting balance and maps schedules", () => {
    const input = buildEducationMcInput(report, { arithMean: 0.06, stdDev: 0.12 }, 99);
    expect(input.startingBalance).toBe(30000);
    expect(input.withdrawalsByYear).toEqual([0, 30000]);
    expect(input.contributionsByYear[0]).toBe(1800);
    expect(input.seed).toBe(99);
  });

  it("ignores accumulation rows so the gauge stays scoped to the expense phase", () => {
    // Two pre-expense accumulation years precede the same expense row. The MC
    // input must be byte-for-byte identical to the no-accumulation case: start
    // at the first EXPENSE row's BOY, and never fold the accumulation years'
    // growthAndSavings into contributionsByYear.
    const withAccumulation = {
      ...report,
      rows: [
        { goalId: "edu", year: 2024, dedicatedAssetsBOY: 26000, growthAndSavings: 1560, goalExpense: 0, otherExpenseFlows: 0, dedicatedWithdrawal: 0, dedicatedAssetsEOY: 27560, shortfall: 0, accumulation: true },
        { goalId: "edu", year: 2025, dedicatedAssetsBOY: 27560, growthAndSavings: 1653, goalExpense: 0, otherExpenseFlows: 0, dedicatedWithdrawal: 0, dedicatedAssetsEOY: 29213, shortfall: 0, accumulation: true },
        ...report.rows,
      ],
    } as EducationGoalReport;

    const base = buildEducationMcInput(report, { arithMean: 0.06, stdDev: 0.12 }, 99);
    const withAcc = buildEducationMcInput(withAccumulation, { arithMean: 0.06, stdDev: 0.12 }, 99);

    expect(withAcc.startingBalance).toBe(30000); // first EXPENSE row, not 26000
    expect(withAcc.contributionsByYear).toEqual(base.contributionsByYear);
    expect(withAcc.withdrawalsByYear).toEqual(base.withdrawalsByYear);
  });
});

describe("buildEducationReturnStats", () => {
  // Two asset classes shared across cases below.
  const ASSET_CLASS_STATS = new Map([
    ["equity", { arithMean: 0.08, stdDev: 0.16 }],
    ["bond", { arithMean: 0.03, stdDev: 0.05 }],
  ]);

  it("blends two mixed-mix accounts, weighted by balance", () => {
    // acctA: 10,000 @ 60/40 equity/bond → arith 0.06, std 0.116
    // acctB: 20,000 @ 80/20 equity/bond → arith 0.07, std 0.138
    // balance-weighted: arith = (10000*0.06 + 20000*0.07) / 30000 = 2000/30000
    //                   std   = (10000*0.116 + 20000*0.138) / 30000 = 3920/30000
    const out = buildEducationReturnStats({
      expenses: [{ id: "goal-1", type: "education", dedicatedAccountIds: ["acctA", "acctB"] }],
      accounts: [
        { id: "acctA", value: 10000, growthRate: 0.03 },
        { id: "acctB", value: 20000, growthRate: 0.02 },
      ],
      accountMixes: [
        {
          accountId: "acctA",
          mix: [
            { assetClassId: "equity", weight: 0.6 },
            { assetClassId: "bond", weight: 0.4 },
          ],
        },
        {
          accountId: "acctB",
          mix: [
            { assetClassId: "equity", weight: 0.8 },
            { assetClassId: "bond", weight: 0.2 },
          ],
        },
      ],
      assetClassStats: ASSET_CLASS_STATS,
    });
    expect(out["goal-1"].arithMean).toBeCloseTo(2000 / 30000, 10);
    expect(out["goal-1"].stdDev).toBeCloseTo(3920 / 30000, 10);
  });

  it("all-fixed-rate pool → growthRate = balance-weighted fixed rate, stdDev = 0", () => {
    // acctC: 5,000 @ 4% fixed, acctD: 15,000 @ 5% fixed, no mix on either.
    // weighted rate = (5000*0.04 + 15000*0.05) / 20000 = 950/20000 = 0.0475
    const out = buildEducationReturnStats({
      expenses: [{ id: "goal-2", type: "education", dedicatedAccountIds: ["acctC", "acctD"] }],
      accounts: [
        { id: "acctC", value: 5000, growthRate: 0.04 },
        { id: "acctD", value: 15000, growthRate: 0.05 },
      ],
      accountMixes: [],
      assetClassStats: ASSET_CLASS_STATS,
    });
    expect(out["goal-2"].arithMean).toBeCloseTo(950 / 20000, 10);
    expect(out["goal-2"].stdDev).toBe(0);
  });

  it("zero-balance account is skipped — result identical with/without it", () => {
    const base = {
      expenses: [{ id: "goal-3", type: "education", dedicatedAccountIds: ["acctC", "acctD"] }],
      accounts: [
        { id: "acctC", value: 5000, growthRate: 0.04 },
        { id: "acctD", value: 15000, growthRate: 0.05 },
      ],
      accountMixes: [],
      assetClassStats: ASSET_CLASS_STATS,
    };
    const withoutZero = buildEducationReturnStats(base);

    const withZero = buildEducationReturnStats({
      ...base,
      expenses: [{ id: "goal-3", type: "education", dedicatedAccountIds: ["acctC", "acctD", "acctZero"] }],
      accounts: [...base.accounts, { id: "acctZero", value: 0, growthRate: 0.1 }],
    });

    expect(withZero["goal-3"]).toEqual(withoutZero["goal-3"]);
  });

  it("missing asset-class id in indices is skipped without producing NaN", () => {
    // acctF: 10,000 @ 50% equity (known) / 50% "unknown" (not in assetClassStats).
    // The unknown slice contributes nothing (skipped, not renormalized):
    // arith = 0.5*0.08 = 0.04, std = 0.5*0.16 = 0.08.
    const out = buildEducationReturnStats({
      expenses: [{ id: "goal-4", type: "education", dedicatedAccountIds: ["acctF"] }],
      accounts: [{ id: "acctF", value: 10000, growthRate: 0.03 }],
      accountMixes: [
        {
          accountId: "acctF",
          mix: [
            { assetClassId: "equity", weight: 0.5 },
            { assetClassId: "unknown-class", weight: 0.5 },
          ],
        },
      ],
      assetClassStats: ASSET_CLASS_STATS,
    });
    expect(out["goal-4"].arithMean).toBeCloseTo(0.04, 10);
    expect(out["goal-4"].stdDev).toBeCloseTo(0.08, 10);
    expect(Number.isNaN(out["goal-4"].arithMean)).toBe(false);
    expect(Number.isNaN(out["goal-4"].stdDev)).toBe(false);
  });
});
