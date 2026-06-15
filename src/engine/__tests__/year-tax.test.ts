import { describe, it, expect } from "vitest";
import { computeTaxForYear } from "../year-tax";
import { basePlanSettings } from "./fixtures";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
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

  // Shared builder for the F23/F22 charitable-election tests. Bracket mode with the
  // 2026 fixture (single std = 15,000). High taxableIncome → charityAgi well above
  // the 60% ceiling so the election/floor behavior is isolated from the AGI cap.
  function charityInput(over: {
    year?: number;
    filingStatus?: "single" | "married_joint" | "married_separate" | "head_of_household";
    itemizedDeductions?: number;
    charityGiftsThisYear?: { amount: number; bucket: import("../charitable-deduction").CharityBucket }[];
    charityCarryforwardIn?: import("../types").CharityCarryforward;
    taxableIncome?: number;
  }) {
    return {
      taxDetail: {
        earnedIncome: 0,
        ordinaryIncome: over.taxableIncome ?? 1_000_000,
        dividends: 0,
        capitalGains: 0,
        stCapitalGains: 0,
        qbi: 0,
        taxExempt: 0,
        taxExemptInterest: 0,
        bySource: {},
      },
      socialSecurityGross: 0,
      totalIncome: over.taxableIncome ?? 1_000_000,
      taxableIncome: over.taxableIncome ?? 1_000_000,
      filingStatus: over.filingStatus ?? ("single" as const),
      year: over.year ?? 2026,
      planSettings: basePlanSettings,
      resolved: { params: TAX_YEAR_2026, inflationFactor: 1 },
      useBracket: true,
      aboveLineDeductions: 0,
      itemizedDeductions: over.itemizedDeductions ?? 0,
      charityCarryforwardIn: over.charityCarryforwardIn ?? emptyCharityCarryforward(),
      charityGiftsThisYear: over.charityGiftsThisYear ?? [],
      secaResult: { seTax: 0, deductibleHalf: 0 },
      transferEarlyWithdrawalPenalty: 0,
      interestIncomeForTax: 0,
      deductionBreakdownIn: null,
    };
  }

  it("F23: large charitable gift drives the itemize election", () => {
    // single filer, std 15,000; itemizedIn 5,000; $50k cash gift; high AGI.
    // 5,000 + 50,000 = 55,000 > 15,000 → itemize, full 50k deducted.
    // Year 2025 isolates the election from the 2026+ F22 floor.
    const out = computeTaxForYear(
      charityInput({
        year: 2025,
        filingStatus: "single",
        itemizedDeductions: 5_000,
        charityGiftsThisYear: [{ amount: 50_000, bucket: "cashPublic" }],
      }),
    );
    expect(out.charityDeductionThisYear).toBe(50_000);
  });

  it("F23: when standard wins, current-year gift goes to carryforward, prior intact", () => {
    const out = computeTaxForYear(
      charityInput({
        filingStatus: "single",
        itemizedDeductions: 2_000,
        charityGiftsThisYear: [{ amount: 3_000, bucket: "cashPublic" }],
      }),
    );
    // 2,000 + 3,000 = 5,000 < 15,000 → standard → $0 deducted this year.
    expect(out.charityDeductionThisYear).toBe(0);
    // current-year 3,000 appended to carryforward (nothing consumed).
    const cf = out.charityCarryforwardOut.cashPublic;
    expect(cf.reduce((s, e) => s + e.amount, 0)).toBeGreaterThanOrEqual(3_000);
  });

  it("F23: standard branch decays prior carryforward but consumes nothing", () => {
    const out = computeTaxForYear(
      charityInput({
        filingStatus: "single",
        itemizedDeductions: 2_000,
        charityGiftsThisYear: [{ amount: 3_000, bucket: "cashPublic" }],
        charityCarryforwardIn: {
          cashPublic: [
            { amount: 10_000, originYear: 2020 }, // 6 yrs old in 2026 → expired/dropped
            { amount: 5_000, originYear: 2025 }, // valid → preserved untouched
          ],
          cashPrivate: [],
          appreciatedPublic: [],
          appreciatedPrivate: [],
        },
      }),
    );
    expect(out.charityDeductionThisYear).toBe(0);
    // Expired 2020 entry dropped; 2025 entry preserved; current-year 3,000 appended.
    expect(out.charityCarryforwardOut.cashPublic).toEqual([
      { amount: 5_000, originYear: 2025 },
      { amount: 3_000, originYear: 2026 },
    ]);
  });

  it("BUG #11: SS §86 combined income uses muni interest only, not the broad taxExempt bucket", () => {
    // Broad taxExempt = 50k (e.g. non-taxable business pass-through) but muni
    // interest = 0. The §86 worksheet must see only the muni subset, so the 50k
    // must NOT inflate combined income and over-tax Social Security.
    const input = {
      taxDetail: {
        earnedIncome: 0,
        ordinaryIncome: 30_000,
        dividends: 0,
        capitalGains: 0,
        stCapitalGains: 0,
        qbi: 0,
        taxExempt: 50_000,        // broad non-taxable bucket
        taxExemptInterest: 0,     // narrow muni-only subset
        bySource: {},
      },
      socialSecurityGross: 40_000,
      totalIncome: 80_000,
      taxableIncome: 30_000,
      filingStatus: "married_joint" as const,
      year: 2026,
      planSettings: basePlanSettings,
      resolved: { params: TAX_YEAR_2026, inflationFactor: 1 },
      useBracket: true,
      aboveLineDeductions: 0,
      itemizedDeductions: 0,
      charityCarryforwardIn: emptyCharityCarryforward(),
      charityGiftsThisYear: [],
      secaResult: { seTax: 0, deductibleHalf: 0 },
      transferEarlyWithdrawalPenalty: 0,
      interestIncomeForTax: 0,
      deductionBreakdownIn: null,
    };
    // combined = 30000 + 0.5×40000 + 0 = 50000 (> MFJ base2 44000)
    //   taxable SS = 6000 + 0.85×(50000-44000) = 11100
    // (Buggy: broad bucket → combined 100000 → taxable SS capped at 0.85×40000 = 34000.)
    const out = computeTaxForYear(input);
    expect(out.taxResult.income.taxableSocialSecurity).toBeCloseTo(11100, 0);
  });
});
