import { describe, it, expect } from "vitest";
import { buildCashFlowGoalReports, buildGoalReport } from "../goal-report-data";
import type { ProjectionYear } from "@/engine/types";

const py = (year: number, g: Partial<import("@/engine/types").GoalYear>): ProjectionYear =>
  ({ year, goals: [{ goalId: "edu", dedicatedAssetsBOY: 0, growthAndSavings: 0, goalExpense: 0, otherExpenseFlows: 0, dedicatedWithdrawal: 0, outOfPocketWithdrawal: 0, dedicatedAssetsEOY: 0, shortfall: 0, ...g }] } as ProjectionYear);

describe("buildGoalReport", () => {
  it("groups per goal, sums KPIs, builds chart series", () => {
    const years = [
      py(2026, { dedicatedAssetsEOY: 31800 }),
      py(2033, { goalExpense: 40000, dedicatedWithdrawal: 30000, shortfall: 10000, dedicatedAssetsEOY: 0 }),
    ];
    const [report] = buildGoalReport(years, [{ id: "edu", name: "College for Child" }]);
    expect(report.name).toBe("College for Child");
    expect(report.dedicatedFundsUsed).toBe(30000);
    expect(report.totalShortfall).toBe(10000);
    expect(report.totalGoalCost).toBe(40000); // accumulation years contribute nothing
    expect(report.chart.labels).toEqual(["2026", "2033"]);
    expect(report.chart.remaining).toEqual([31800, 0]);
    expect(report.chart.withdrawals).toEqual([0, 30000]);
    expect(report.chart.shortfall).toEqual([0, 10000]);
  });

  it("separates cash-flow (out-of-pocket) funding from unfunded shortfall", () => {
    const years = [
      py(2033, { goalExpense: 40000, dedicatedWithdrawal: 25000, outOfPocketWithdrawal: 15000, shortfall: 0, dedicatedAssetsEOY: 0 }),
      py(2034, { goalExpense: 40000, dedicatedWithdrawal: 30000, outOfPocketWithdrawal: 0, shortfall: 10000, dedicatedAssetsEOY: 0 }),
    ];
    const [report] = buildGoalReport(years, [{ id: "edu", name: "College" }]);
    expect(report.cashFlowFundsUsed).toBe(15000);
    expect(report.totalShortfall).toBe(10000); // unfunded only, not the cash-flow portion
    expect(report.totalGoalCost).toBe(80000); // both expense years
    expect(report.chart.outOfPocket).toEqual([15000, 0]);
    expect(report.chart.shortfall).toEqual([0, 10000]);
  });

  it("returns [] when no education goals exist", () => {
    expect(buildGoalReport([{ year: 2026 } as ProjectionYear], [])).toEqual([]);
  });
});

describe("buildCashFlowGoalReports", () => {
  const year = (y: number, cost: number, inflow: number, totalExpenses: number) =>
    ({
      year: y,
      expenses: { bySource: { car: cost } },
      income: { socialSecurity: 0, salaries: inflow, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0 },
      withdrawals: { byAccount: {}, total: 0 },
      accountLedgers: {},
      totalExpenses,
    }) as unknown as ProjectionYear;

  it("funds a cash-flow goal at the year's coverage, the portal's rule", () => {
    const [r] = buildCashFlowGoalReports([year(2029, 60000, 50000, 100000)], [{ id: "car", name: "New car" }]);
    expect(r).toMatchObject({ goalId: "car", name: "New car", totalCost: 60000, totalFunded: 30000 });
    expect(r.rows).toEqual([{ year: 2029, cost: 60000, funded: 30000 }]);
  });

  it("drops a goal the projection never reaches", () => {
    expect(buildCashFlowGoalReports([year(2029, 0, 0, 0)], [{ id: "car", name: "New car" }])).toEqual([]);
  });
});
