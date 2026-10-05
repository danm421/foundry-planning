import { describe, it, expect } from "vitest";
import { goalYearColumns } from "../goal-year-columns";

describe("goalYearColumns", () => {
  it("renders the 9 report columns and flags shortfall rows", () => {
    const cols = goalYearColumns();
    expect(cols.map((c) => c.header)).toEqual([
      "Year", "Dedicated Assets (BOY)", "Dedicated Assets Growth & Savings",
      "Goal Expense", "Other Expenses Flows", "Dedicated Withdrawals",
      "Cash-Flow Withdrawals", "Dedicated Assets (EOY)", "Shortfall",
    ]);
    const row = { goalId: "e", kind: "education" as const, year: 2033, dedicatedAssetsBOY: 0, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 30000, householdWithdrawal: 0, outOfPocketWithdrawal: 0, dedicatedAssetsEOY: 0, shortfall: 10000 };
    const shortfallCol = cols.find((c) => c.header === "Shortfall")!;
    expect(shortfallCol.tone?.(row)).toBe("crit");
  });
});
