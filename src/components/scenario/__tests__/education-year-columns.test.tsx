import { describe, it, expect } from "vitest";
import { educationYearColumns } from "../education-year-columns";

describe("educationYearColumns", () => {
  it("renders the 8 report columns and flags shortfall rows", () => {
    const cols = educationYearColumns();
    expect(cols.map((c) => c.header)).toEqual([
      "Year", "Dedicated Assets (BOY)", "Dedicated Assets Growth & Savings",
      "Goal Expense", "Other Expenses Flows", "Dedicated Withdrawals",
      "Dedicated Assets (EOY)", "Shortfall",
    ]);
    const row = { goalId: "e", year: 2033, dedicatedAssetsBOY: 0, growthAndSavings: 0, goalExpense: 40000, otherExpenseFlows: 0, dedicatedWithdrawal: 30000, dedicatedAssetsEOY: 0, shortfall: 10000 };
    const shortfallCol = cols.find((c) => c.header === "Shortfall")!;
    expect(shortfallCol.tone?.(row)).toBe("crit");
  });
});
