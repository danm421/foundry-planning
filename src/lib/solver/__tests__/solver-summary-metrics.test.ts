import { describe, it, expect } from "vitest";
import { yearsFullyFunded, lifetimeTaxes, portfolioAtYear } from "../solver-summary-metrics";
import type { ProjectionYear } from "@/engine/types";

// liquidPortfolioTotal (from @/engine/monteCarlo/trial) reads
// portfolioAssets.taxableTotal + cashTotal + retirementTotal.
// Supply that shape; put all liquid value in taxableTotal for simplicity.
const y = (liquidTotal: number, taxes: number, year = 0) =>
  ({
    year,
    portfolioAssets: { taxableTotal: liquidTotal, cashTotal: 0, retirementTotal: 0, liquidTotal },
    expenses: { taxes },
  }) as unknown as ProjectionYear;

describe("solver summary metrics", () => {
  it("counts years with non-negative liquid portfolio", () => {
    expect(yearsFullyFunded([y(100, 0), y(0, 0), y(-5, 0)])).toBe(2);
  });
  it("sums per-year taxes", () => {
    expect(lifetimeTaxes([y(0, 1000), y(0, 2500), y(0, 0)])).toBe(3500);
  });

  describe("portfolioAtYear", () => {
    const years = [y(500_000, 0, 2026), y(800_000, 0, 2035), y(1_200_000, 0, 2060)];
    it("returns the liquid portfolio total for the matching year", () => {
      expect(portfolioAtYear(years, 2035)).toBe(800_000);
    });
    it("returns null when no projection year matches (beyond horizon)", () => {
      expect(portfolioAtYear(years, 2099)).toBeNull();
    });
    it("returns null for a year before the projection (already retired)", () => {
      expect(portfolioAtYear(years, 2010)).toBeNull();
    });
    it("returns null for an empty projection", () => {
      expect(portfolioAtYear([], 2035)).toBeNull();
    });
    it("reads liquidTotal (incl. life insurance + trust), not the narrow taxable+cash+retirement sum", () => {
      const rowWithLifeInsurance = {
        year: 2040,
        portfolioAssets: { taxableTotal: 500_000, cashTotal: 0, retirementTotal: 0, liquidTotal: 650_000 },
        expenses: { taxes: 0 },
      } as unknown as ProjectionYear;
      expect(portfolioAtYear([rowWithLifeInsurance], 2040)).toBe(650_000);
    });
  });
});
