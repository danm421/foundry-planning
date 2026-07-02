import { describe, it, expect } from "vitest";
import { buildEducationReport } from "../education-report-data";
import type { ProjectionYear } from "@/engine/types";

const py = (year: number, g: Partial<import("@/engine/types").EducationGoalYear>): ProjectionYear =>
  ({ year, educationGoals: [{ goalId: "edu", dedicatedAssetsBOY: 0, growthAndSavings: 0, goalExpense: 0, otherExpenseFlows: 0, dedicatedWithdrawal: 0, outOfPocketWithdrawal: 0, dedicatedAssetsEOY: 0, shortfall: 0, ...g }] } as ProjectionYear);

describe("buildEducationReport", () => {
  it("groups per goal, sums KPIs, builds chart series", () => {
    const years = [
      py(2026, { dedicatedAssetsEOY: 31800 }),
      py(2033, { goalExpense: 40000, dedicatedWithdrawal: 30000, shortfall: 10000, dedicatedAssetsEOY: 0 }),
    ];
    const [report] = buildEducationReport(years, [{ id: "edu", name: "College for Child" }]);
    expect(report.name).toBe("College for Child");
    expect(report.dedicatedFundsUsed).toBe(30000);
    expect(report.totalShortfall).toBe(10000);
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
    const [report] = buildEducationReport(years, [{ id: "edu", name: "College" }]);
    expect(report.cashFlowFundsUsed).toBe(15000);
    expect(report.totalShortfall).toBe(10000); // unfunded only, not the cash-flow portion
    expect(report.chart.outOfPocket).toEqual([15000, 0]);
    expect(report.chart.shortfall).toEqual([0, 10000]);
  });

  it("returns [] when no education goals exist", () => {
    expect(buildEducationReport([{ year: 2026 } as ProjectionYear], [])).toEqual([]);
  });
});
