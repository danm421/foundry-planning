import { describe, it, expect } from "vitest";
import { compactYear } from "../compact-year";
import type { ProjectionYear } from "@/engine/types";

function row(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  return {
    year: 2030,
    ages: { client: 60 },
    income: { total: 200_000 },
    expenses: { total: 150_000 },
    netCashFlow: 50_000,
    portfolioAssets: 2_400_000,
    ...overrides,
  } as unknown as ProjectionYear;
}

describe("compactYear", () => {
  it("projects only the fields the model needs", () => {
    expect(compactYear(row())).toEqual({
      year: 2030,
      ages: { client: 60 },
      totalIncome: 200_000,
      totalExpenses: 150_000,
      netCashFlow: 50_000,
      totalTax: null,
      medicareTotal: null,
      irmaaSurcharge: null,
      portfolioAssets: 2_400_000,
    });
  });

  it("reads tax and Medicare when present", () => {
    const out = compactYear(
      row({
        taxResult: { flow: { totalTax: 42_000 } },
        medicare: { totalAnnualCost: 9_000, totalIrmaaSurcharge: 1_200 },
      } as unknown as Partial<ProjectionYear>),
    );
    expect(out.totalTax).toBe(42_000);
    expect(out.medicareTotal).toBe(9_000);
    expect(out.irmaaSurcharge).toBe(1_200);
  });
});
