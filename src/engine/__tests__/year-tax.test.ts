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
});
