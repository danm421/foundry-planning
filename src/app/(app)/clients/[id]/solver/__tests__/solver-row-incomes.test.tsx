import { describe, it, expect } from "vitest";
import type { Income } from "@/engine";
import { incomeDetailRows } from "../solver-row-incomes";

function income(p: Partial<Income>): Income {
  return {
    id: "i1",
    type: "salary",
    owner: "client",
    annualAmount: 100000,
    taxType: "earned_income",
    growthSource: "custom",
    growthRate: 0.02,
    ...p,
  } as Income;
}

describe("incomeDetailRows", () => {
  it("maps tax type and a custom growth rate", () => {
    expect(incomeDetailRows(income({}))).toEqual([
      { term: "Taxed as", value: "earned" },
      { term: "Growth", value: "2%" },
    ]);
  });

  it("renders inflation-linked growth and a self-employment tag", () => {
    expect(
      incomeDetailRows(income({ growthSource: "inflation", isSelfEmployment: true })),
    ).toEqual([
      { term: "Taxed as", value: "earned" },
      { value: "SE" },
      { term: "Growth", value: "infl-linked" },
    ]);
  });

  it("adds a Through row when an end year is set", () => {
    expect(incomeDetailRows(income({ endYear: 2050 }))).toEqual([
      { term: "Taxed as", value: "earned" },
      { term: "Growth", value: "2%" },
      { term: "Through", value: "2050" },
    ]);
  });
});
