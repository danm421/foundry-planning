import { describe, it, expect } from "vitest";
import { computeTaxForYear } from "../year-tax";
import { basePlanSettings } from "./fixtures";
import { emptyCharityCarryforward } from "../types";

// NOTE: The plan originally proposed two `runProjection`-driven placeholder tests
// here, but the genuine parity check happens in Task 6 (full test suite must
// stay green after `projection.ts` is rewired through `computeTaxForYear`).
// At this stage there's no value in re-running runProjection from this file,
// so we keep just the one synthetic-input test that exercises the function
// directly with no fixture dependencies.
describe("computeTaxForYear", () => {
  it("zero income produces zero tax (synthetic input)", () => {
    const out = computeTaxForYear({
      taxDetail: {
        earnedIncome: 0,
        ordinaryIncome: 0,
        dividends: 0,
        capitalGains: 0,
        stCapitalGains: 0,
        qbi: 0,
        taxExempt: 0,
        taxExemptInterest: 0,
        bySource: {},
      },
      socialSecurityGross: 0,
      totalIncome: 0,
      taxableIncome: 0,
      filingStatus: "single",
      year: 2026,
      planSettings: basePlanSettings,
      resolved: null,
      useBracket: false,
      aboveLineDeductions: 0,
      itemizedDeductions: 0,
      charityCarryforwardIn: emptyCharityCarryforward(),
      charityGiftsThisYear: [],
      secaResult: { seTax: 0, deductibleHalf: 0 },
      transferEarlyWithdrawalPenalty: 0,
      interestIncomeForTax: 0,
      deductionBreakdownIn: null,
    });
    expect(out.taxes).toBe(0);
    expect(out.charityDeductionThisYear).toBe(0);
  });

  it("records transfer early-withdrawal penalty into flow.earlyWithdrawalPenalty and totalTax", () => {
    const inputWith = (penalty: number) => ({
      taxDetail: {
        earnedIncome: 80_000,
        ordinaryIncome: 80_000,
        dividends: 0,
        capitalGains: 0,
        stCapitalGains: 0,
        qbi: 0,
        taxExempt: 0,
        taxExemptInterest: 0,
        bySource: {},
      },
      socialSecurityGross: 0,
      totalIncome: 80_000,
      taxableIncome: 80_000,
      filingStatus: "single" as const,
      year: 2026,
      planSettings: basePlanSettings,
      resolved: null,
      useBracket: false,
      aboveLineDeductions: 0,
      itemizedDeductions: 0,
      charityCarryforwardIn: emptyCharityCarryforward(),
      charityGiftsThisYear: [],
      secaResult: { seTax: 0, deductibleHalf: 0 },
      transferEarlyWithdrawalPenalty: penalty,
      interestIncomeForTax: 0,
      deductionBreakdownIn: null,
    });

    const base = computeTaxForYear(inputWith(0));
    const withPenalty = computeTaxForYear(inputWith(1_000));

    expect(base.taxResult.flow.earlyWithdrawalPenalty).toBe(0);
    expect(withPenalty.taxResult.flow.earlyWithdrawalPenalty).toBe(1_000);
    expect(withPenalty.taxResult.flow.totalTax).toBe(base.taxResult.flow.totalTax + 1_000);
    expect(withPenalty.taxResult.flow.totalFederalTax).toBe(
      base.taxResult.flow.totalFederalTax + 1_000,
    );
  });

  it("BUG #18: SE-side Additional Medicare surtax flows into flow.additionalMedicare and totals", () => {
    const inputWith = (secaResult: {
      seTax: number;
      deductibleHalf: number;
      additionalMedicare?: number;
    }) => ({
      taxDetail: {
        earnedIncome: 0,
        ordinaryIncome: 0,
        dividends: 0,
        capitalGains: 0,
        stCapitalGains: 0,
        qbi: 0,
        taxExempt: 0,
        taxExemptInterest: 0,
        bySource: {},
      },
      socialSecurityGross: 0,
      totalIncome: 0,
      taxableIncome: 0,
      filingStatus: "single" as const,
      year: 2026,
      planSettings: basePlanSettings,
      resolved: null,
      useBracket: false,
      aboveLineDeductions: 0,
      itemizedDeductions: 0,
      charityCarryforwardIn: emptyCharityCarryforward(),
      charityGiftsThisYear: [],
      secaResult,
      transferEarlyWithdrawalPenalty: 0,
      interestIncomeForTax: 0,
      deductionBreakdownIn: null,
    });

    // $400k SE earnings, $0 wages → SE tax + $1,524.60 SE-side surtax.
    const withSurtax = computeTaxForYear(
      inputWith({ seTax: 50_000, deductibleHalf: 25_000, additionalMedicare: 1_524.6 }),
    );
    const withoutSurtax = computeTaxForYear(
      inputWith({ seTax: 50_000, deductibleHalf: 25_000, additionalMedicare: 0 }),
    );

    expect(withSurtax.taxResult.flow.additionalMedicare).toBeCloseTo(1_524.6, 2);
    expect(withSurtax.taxResult.flow.totalTax).toBeCloseTo(
      withoutSurtax.taxResult.flow.totalTax + 1_524.6,
      2,
    );
    expect(withSurtax.taxResult.flow.totalFederalTax).toBeCloseTo(
      withoutSurtax.taxResult.flow.totalFederalTax + 1_524.6,
      2,
    );
  });
});
