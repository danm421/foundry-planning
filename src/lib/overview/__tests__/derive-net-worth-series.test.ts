import { describe, it, expect } from "vitest";
import { deriveNetWorthSeries } from "../derive-net-worth-series";
import type { ProjectionYear } from "@/engine";

function mkYear(
  year: number,
  categoryTotal: number,
  liabilityBalance: number,
): ProjectionYear {
  return {
    year,
    ages: { client: 40 + (year - 2025) },
    portfolioAssets: {
      taxable: {},
      cash: {},
      retirement: {},
      realEstate: {},
      business: {},
      lifeInsurance: {},
      taxableTotal: categoryTotal / 6,
      cashTotal: categoryTotal / 6,
      retirementTotal: categoryTotal / 6,
      realEstateTotal: categoryTotal / 6,
      businessTotal: categoryTotal / 6,
      lifeInsuranceTotal: categoryTotal / 6,
      total: categoryTotal,
    },
    liabilityBalancesBoY: liabilityBalance > 0 ? { "liab-1": liabilityBalance } : {},
  } as unknown as ProjectionYear;
}

describe("deriveNetWorthSeries", () => {
  it("sums category totals and subtracts liability balances per year", () => {
    const projection = [
      mkYear(2025, 1_000_000, 200_000),
      mkYear(2026, 1_050_000, 180_000),
      mkYear(2027, 1_100_000, 0),
    ];
    const series = deriveNetWorthSeries(projection);
    expect(series).toEqual([800_000, 870_000, 1_100_000]);
  });

  it("returns empty array for empty projection", () => {
    expect(deriveNetWorthSeries([])).toEqual([]);
  });

  it("sums multiple liabilities per year", () => {
    const y: ProjectionYear = {
      year: 2025,
      ages: { client: 40 },
      portfolioAssets: {
        taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {},
        taxableTotal: 500_000,
        cashTotal: 100_000,
        retirementTotal: 400_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        total: 1_000_000,
      },
      liabilityBalancesBoY: { "mortgage": 300_000, "heloc": 50_000, "card": 10_000 },
    } as unknown as ProjectionYear;
    expect(deriveNetWorthSeries([y])).toEqual([640_000]);
  });
});
