import { describe, it, expect } from "vitest";
import { sumLifetimeTax } from "../lifetime-tax";
import type { ProjectionYear } from "@/engine/types";

function makeYear(overrides: Partial<ProjectionYear["taxResult"]>): ProjectionYear {
  return {
    taxResult: {
      income: {
        earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0,
        dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        totalIncome: 0, nonTaxableIncome: 0, grossTotalIncome: 0,
      },
      flow: {
        aboveLineDeductions: 0, adjustedGrossIncome: 0, qbiDeduction: 0,
        belowLineDeductions: 0, taxableIncome: 0, incomeTaxBase: 0,
        regularTaxCalc: 0, amtCredit: 0, taxCredits: 0,
        regularFederalIncomeTax: 0, capitalGainsTax: 0, amtAdditional: 0,
        niit: 0, additionalMedicare: 0, fica: 0, stateTax: 0,
        totalFederalTax: 0, totalTax: 0,
        ...overrides?.flow,
      },
      diag: {} as never,
    },
  } as unknown as ProjectionYear;
}

describe("sumLifetimeTax", () => {
  it("returns zeros for an empty array", () => {
    expect(sumLifetimeTax([])).toEqual({
      total: 0,
      byBucket: {
        regularFederalIncomeTax: 0,
        capitalGainsTax: 0,
        amtAdditional: 0,
        niit: 0,
        additionalMedicare: 0,
        fica: 0,
        stateTax: 0,
      },
    });
  });

  it("sums totalTax across years and per-bucket fields", () => {
    const years = [
      makeYear({ flow: { regularFederalIncomeTax: 100, capitalGainsTax: 20, totalTax: 120 } as never }),
      makeYear({ flow: { regularFederalIncomeTax: 50, niit: 10, totalTax: 60 } as never }),
    ];
    const result = sumLifetimeTax(years);
    expect(result.total).toBe(180);
    expect(result.byBucket.regularFederalIncomeTax).toBe(150);
    expect(result.byBucket.capitalGainsTax).toBe(20);
    expect(result.byBucket.niit).toBe(10);
    expect(result.byBucket.amtAdditional).toBe(0);
  });

  it("treats years with missing taxResult as zero", () => {
    const years = [{} as ProjectionYear, makeYear({ flow: { totalTax: 50 } as never })];
    expect(sumLifetimeTax(years).total).toBe(50);
  });
});
