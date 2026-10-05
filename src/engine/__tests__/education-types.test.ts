import { describe, it, expect } from "vitest";
import type { Expense, GoalYear, ProjectionYear } from "../types";

describe("education engine types", () => {
  it("Expense accepts type education + dedicated funding fields", () => {
    const e: Expense = {
      id: "e1",
      type: "education",
      name: "College for Child",
      annualAmount: 39493,
      startYear: 2033,
      endYear: 2036,
      growthRate: 0.0254,
      dedicatedAccountIds: ["a1", "a2"],
      payShortfallOutOfPocket: false,
      institutionState: "Pennsylvania",
      institutionName: "Penn State",
      forFamilyMemberId: "fm1",
    };
    expect(e.type).toBe("education");
  });

  it("GoalYear + ProjectionYear.goals shape", () => {
    const row: GoalYear = {
      goalId: "e1",
      kind: "education",
      dedicatedAssetsBOY: 30000,
      growthAndSavings: 1800,
      goalExpense: 0,
      otherExpenseFlows: 0,
      dedicatedWithdrawal: 0,
      householdWithdrawal: 0,
      outOfPocketWithdrawal: 0,
      dedicatedAssetsEOY: 31800,
      shortfall: 0,
    };
    const py = { goals: [row] } as Partial<ProjectionYear>;
    expect(py.goals?.[0].dedicatedAssetsEOY).toBe(31800);
  });
});
