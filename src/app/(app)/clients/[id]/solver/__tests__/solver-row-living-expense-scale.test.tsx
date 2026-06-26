import { describe, it, expect } from "vitest";
import type { Expense } from "@/engine";
import { livingExpenseDetailRows } from "../solver-row-living-expense-scale";

function expense(p: Partial<Expense>): Expense {
  return {
    id: "e1",
    type: "living",
    name: "Living Expenses",
    annualAmount: 150000,
    startYear: 2035,
    endYear: 2070,
    growthRate: 0.024,
    ...p,
  } as Expense;
}

describe("livingExpenseDetailRows", () => {
  it("returns Growth and Applies rows", () => {
    expect(livingExpenseDetailRows(expense({}))).toEqual([
      { term: "Growth", value: "2.40%" },
      { term: "Applies", value: "2035–2070" },
    ]);
  });

  it("omits Growth when the rate is zero", () => {
    expect(livingExpenseDetailRows(expense({ growthRate: 0 }))).toEqual([
      { term: "Applies", value: "2035–2070" },
    ]);
  });
});
