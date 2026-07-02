import { describe, it, expect } from "vitest";
import { buildEducationMcInput } from "../education-mc-inputs";
import type { EducationGoalReport } from "../education-report-data";

const report = {
  goalId: "edu", name: "College", dedicatedFundsUsed: 30000, totalShortfall: 10000,
  chart: { labels: [], remaining: [], withdrawals: [], shortfall: [] },
  rows: [
    { goalId: "edu", year: 2026, dedicatedAssetsBOY: 30000, growthAndSavings: 1800, goalExpense: 0, otherExpenseFlows: 0, dedicatedWithdrawal: 0, dedicatedAssetsEOY: 31800, shortfall: 0 },
    { goalId: "edu", year: 2033, dedicatedAssetsBOY: 40000, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 30000, dedicatedAssetsEOY: 0, shortfall: 10000 },
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
});
