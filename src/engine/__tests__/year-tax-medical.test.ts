import { describe, it, expect } from "vitest";
import { computeTaxForYear, type YearTaxInput } from "../year-tax";
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

/** Adds a breakdown (standard 15,000, plus `taxesPaid` as the other itemized
 *  line) so a test can read the medical and charity lines off the result. */
function withBreakdown(i: YearTaxInput, taxesPaid = 0): YearTaxInput {
  return {
    ...i,
    deductionBreakdownIn: {
      aboveLine: { retirementContributions: 0, taggedExpenses: 0, manualEntries: 0, studentLoanInterest: 0, total: 0, bySource: {} },
      belowLine: {
        charitable: 0, taxesPaid, stateIncomeTax: 0, propertyTaxes: 0, interestPaid: 0,
        otherItemized: 0, itemizedTotal: taxesPaid, standardDeduction: 15_000,
        taxDeductions: Math.max(taxesPaid, 15_000), bySource: {},
      },
    },
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
    const bd = computeTaxForYear(withBreakdown(input({ medicalExpenses: 80_000 }))).deductionBreakdown!.belowLine;
    expect(bd.otherItemized).toBeCloseTo(65_000, 0);
    expect(bd.itemizedTotal).toBeCloseTo(65_000, 0);
    expect(bd.taxDeductions).toBeCloseTo(65_000, 0);
    expect(bd.bySource.medical).toEqual({ label: "Medical expenses above 7.5% of AGI", amount: expect.closeTo(65_000, 0) });
  });

  it("the floor is 7.5% of the AGI the tax calculation reports, even in a capital-loss year", () => {
    // 200,000 ordinary and a 40,000 long-term loss. The projection folds the
    // SIGNED loss into the taxable-income scalar (160,000 — see
    // capitalGainsInTaxableIncome), but §1211(b) lets only 3,000 of it reduce AGI.
    const base = input({ taxableIncome: 160_000, medicalExpenses: 80_000 });
    const out = computeTaxForYear(withBreakdown({
      ...base,
      taxDetail: { ...base.taxDetail, ordinaryIncome: 200_000, capitalGains: -40_000 },
      capitalGainsInTaxableIncome: { longTerm: -40_000, shortTerm: 0 },
    }));
    const agi = out.taxResult.flow.adjustedGrossIncome;
    expect(agi).toBeCloseTo(197_000, 0);
    const medical = out.deductionBreakdown!.belowLine.bySource.medical.amount;
    expect(Math.abs(medical - Math.max(0, 80_000 - 0.075 * agi))).toBeLessThan(1);
  });

  it("charity and medical in the same year both itemize, each on its own line", () => {
    // 10,000 of other itemized (taxes paid), a 20,000 cash gift, 80,000 of care.
    const out = computeTaxForYear(withBreakdown({
      ...input({ itemizedDeductions: 10_000, medicalExpenses: 80_000 }),
      charityGiftsThisYear: [{ amount: 20_000, bucket: "cashPublic" }],
    }, 10_000));
    const bd = out.deductionBreakdown!.belowLine;
    const agi = out.taxResult.flow.adjustedGrossIncome;
    const medical = bd.bySource.medical.amount;

    expect(out.charityDeductionThisYear).toBeGreaterThan(0);
    expect(bd.charitable).toBeCloseTo(out.charityDeductionThisYear, 6);
    expect(Math.abs(medical - Math.max(0, 80_000 - 0.075 * agi))).toBeLessThan(1);
    expect(bd.otherItemized).toBeCloseTo(medical, 6);
    expect(bd.itemizedTotal).toBeCloseTo(10_000 + out.charityDeductionThisYear + medical, 6);
    expect(bd.taxDeductions).toBe(bd.itemizedTotal);
    // The tax calculation took the same total the breakdown shows.
    expect(out.taxResult.flow.belowLineDeductions).toBeCloseTo(bd.itemizedTotal, 6);
  });
});
