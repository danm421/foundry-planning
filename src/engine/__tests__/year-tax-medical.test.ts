import { describe, it, expect } from "vitest";
import { computeTaxForYear } from "../year-tax";
import { basePlanSettings } from "./fixtures";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
import { emptyCharityCarryforward } from "../types";

function input(over: { taxableIncome?: number; itemizedDeductions?: number; medicalExpenses: number }) {
  const ti = over.taxableIncome ?? 200_000;
  return {
    taxDetail: {
      earnedIncome: 0, ordinaryIncome: ti, dividends: 0, capitalGains: 0, stCapitalGains: 0,
      qbi: 0, taxExempt: 0, taxExemptInterest: 0, bySource: {},
    },
    socialSecurityGross: 0,
    totalIncome: ti,
    taxableIncome: ti,
    filingStatus: "single" as const,
    year: 2026,
    planSettings: { ...basePlanSettings, taxEngineMode: "bracket" as const },
    resolved: { params: TAX_YEAR_2026, inflationFactor: 1 },
    useBracket: true,
    aboveLineDeductions: 0,
    itemizedDeductions: over.itemizedDeductions ?? 0,
    charityCarryforwardIn: emptyCharityCarryforward(),
    charityGiftsThisYear: [],
    secaResult: { seTax: 0, deductibleHalf: 0 },
    transferEarlyWithdrawalPenalty: 0,
    interestIncomeForTax: 0,
    deductionBreakdownIn: null,
    capitalLossCarryforwardIn: { shortTerm: 0, longTerm: 0 },
    capitalGainsInTaxableIncome: { longTerm: 0, shortTerm: 0 },
    medicalExpenses: over.medicalExpenses,
  };
}

describe("medical deduction (§213, 7.5% of AGI)", () => {
  it("deducts only the amount above 7.5% of AGI", () => {
    // AGI 200,000 → floor 15,000. 80,000 of care → 65,000 itemized, beats the 15,000 standard.
    const none = computeTaxForYear(input({ medicalExpenses: 0 }));
    const care = computeTaxForYear(input({ medicalExpenses: 80_000 }));
    // 65,000 itemized replaces the 15,000 standard: 50,000 less taxable income.
    expect(none.taxResult.flow.taxableIncome - care.taxResult.flow.taxableIncome).toBeCloseTo(50_000, 0);
  });

  it("below the floor, nothing changes", () => {
    const none = computeTaxForYear(input({ medicalExpenses: 0 }));
    const small = computeTaxForYear(input({ medicalExpenses: 14_000 }));
    expect(small.taxes).toBeCloseTo(none.taxes, 6);
  });

  it("the deduction shows in the breakdown under Other Itemized with its own source line", () => {
    const withBd = {
      ...input({ medicalExpenses: 80_000 }),
      deductionBreakdownIn: {
        aboveLine: { retirementContributions: 0, taggedExpenses: 0, manualEntries: 0, studentLoanInterest: 0, total: 0, bySource: {} },
        belowLine: {
          charitable: 0, taxesPaid: 0, stateIncomeTax: 0, propertyTaxes: 0, interestPaid: 0,
          otherItemized: 0, itemizedTotal: 0, standardDeduction: 15_000, taxDeductions: 15_000, bySource: {},
        },
      },
    };
    const bd = computeTaxForYear(withBd).deductionBreakdown!.belowLine;
    expect(bd.otherItemized).toBeCloseTo(65_000, 0);
    expect(bd.itemizedTotal).toBeCloseTo(65_000, 0);
    expect(bd.taxDeductions).toBeCloseTo(65_000, 0);
    expect(bd.bySource.medical).toEqual({ label: "Medical expenses above 7.5% of AGI", amount: expect.closeTo(65_000, 0) });
  });
});
