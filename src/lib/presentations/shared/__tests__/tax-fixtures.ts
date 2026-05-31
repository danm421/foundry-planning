// Test fixtures for the Income Tax view-models. Mirrors the cash-flow
// fixtures pattern: a baseYear factory fills every required field with zeros,
// individual years override only what they assert on. Reuses makeClientData
// from the cash-flow fixtures so range/marker behaviour matches.

import type { ProjectionYear } from "@/engine/types";
export { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

type TaxResult = NonNullable<ProjectionYear["taxResult"]>;
type DeductionBreakdown = NonNullable<ProjectionYear["deductionBreakdown"]>;

export function makeTaxResult(over: {
  income?: Partial<TaxResult["income"]>;
  flow?: Partial<TaxResult["flow"]>;
  diag?: Partial<TaxResult["diag"]>;
  state?: Partial<NonNullable<TaxResult["state"]>>;
} = {}): TaxResult {
  return {
    income: {
      earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0, dividends: 0,
      capitalGains: 0, shortCapitalGains: 0, qbi: 0, totalIncome: 0, nonTaxableIncome: 0,
      grossTotalIncome: 0, ...over.income,
    },
    flow: {
      aboveLineDeductions: 0, adjustedGrossIncome: 0, qbiDeduction: 0,
      belowLineDeductions: 0, taxableIncome: 0, incomeTaxBase: 0, regularTaxCalc: 0,
      amtCredit: 0, taxCredits: 0, regularFederalIncomeTax: 0, capitalGainsTax: 0,
      amtAdditional: 0, niit: 0, additionalMedicare: 0, fica: 0, stateTax: 0,
      totalFederalTax: 0, totalTax: 0, earlyWithdrawalPenalty: 0, ...over.flow,
    },
    diag: {
      marginalFederalRate: 0, marginalBracketTier: { from: 0, to: null, rate: 0 },
      incomeBracketsForFiling: [], effectiveFederalRate: 0,
      bracketsUsed: {} as TaxResult["diag"]["bracketsUsed"], inflationFactor: 1,
      ...over.diag,
    },
    state: over.state
      ? {
          state: "PA", year: 0, hasIncomeTax: true, incomeBase: "federal-agi",
          startingIncome: 0,
          addbacks: { taxFreeInterest: 0, other: 0, total: 0 },
          subtractions: { socialSecurity: 0, retirementIncome: 0, capitalGains: 0, preTaxContrib: 0, other: 0, total: 0 },
          stateAGI: 0, stdDeduction: 0, personalExemptionDeduction: 0, exemptionCredits: 0,
          stateTaxableIncome: 0,
          filingStatusUsed: "married_joint",
          stateFilingStatusUsed: "joint",
          bracketsUsed: [{ from: 0, to: null, rate: 0.0307 }], preCreditTax: 0,
          specialRulesApplied: [], stateTax: 0, diag: { notes: [] },
          ...over.state,
        } as NonNullable<TaxResult["state"]>
      : undefined,
  };
}

export function makeDeductionBreakdown(over: {
  aboveLine?: Partial<DeductionBreakdown["aboveLine"]>;
  belowLine?: Partial<DeductionBreakdown["belowLine"]>;
} = {}): DeductionBreakdown {
  return {
    aboveLine: {
      retirementContributions: 0, taggedExpenses: 0, manualEntries: 0, total: 0,
      bySource: {}, ...over.aboveLine,
    },
    belowLine: {
      charitable: 0, taxesPaid: 0, stateIncomeTax: 0, propertyTaxes: 0, interestPaid: 0,
      otherItemized: 0, itemizedTotal: 0, standardDeduction: 0, taxDeductions: 0,
      bySource: {}, ...over.belowLine,
    },
  };
}

function baseYear(over: Partial<ProjectionYear>): ProjectionYear {
  return {
    year: 0,
    ages: { client: 0 },
    rothConversions: [],
    withdrawals: { byAccount: {}, total: 0 },
    accountLedgers: {},
    ...over,
  } as unknown as ProjectionYear;
}

// 2026 pre-retirement, 2031 retirement (matches makeClientData retirementAge 65),
// 2036 mid-retirement. Tax numbers are hand-crafted for clean assertions.
export function makeTaxYears(): ProjectionYear[] {
  return [
    baseYear({
      year: 2026,
      ages: { client: 60, spouse: 56 },
      // QBI lives on taxResult.income (the source the income table reads); the
      // differing taxDetail.qbi proves the view-model no longer reads taxDetail.
      taxDetail: { qbi: 0 } as NonNullable<ProjectionYear["taxDetail"]>,
      rothConversions: [],
      taxResult: makeTaxResult({
        income: {
          earnedIncome: 400_000, ordinaryIncome: 40_000, dividends: 4_000,
          capitalGains: 9_000, qbi: 9_000, totalIncome: 453_000, grossTotalIncome: 453_000,
        },
        flow: {
          aboveLineDeductions: 24_000, adjustedGrossIncome: 429_000,
          belowLineDeductions: 30_000, qbiDeduction: 1_800, taxableIncome: 397_200,
          incomeTaxBase: 384_200, regularFederalIncomeTax: 74_000, capitalGainsTax: 1_350,
          niit: 300, fica: 13_000, stateTax: 9_000, totalFederalTax: 75_650, totalTax: 97_650,
        },
        diag: {
          marginalFederalRate: 0.24,
          marginalBracketTier: { from: 383_900, to: 487_450, rate: 0.24 },
          incomeBracketsForFiling: [
            { from: 0, to: 23_200, rate: 0.10 },
            { from: 23_200, to: 383_900, rate: 0.22 },
            { from: 383_900, to: 487_450, rate: 0.24 },
            { from: 487_450, to: null, rate: 0.32 },
          ],
        },
        state: { startingIncome: 450_000, stateAGI: 450_000, stateTaxableIncome: 450_000, stateTax: 9_000 },
      }),
      deductionBreakdown: makeDeductionBreakdown({
        aboveLine: { retirementContributions: 20_000, taggedExpenses: 3_000, manualEntries: 1_000, total: 24_000 },
        belowLine: {
          charitable: 10_000, taxesPaid: 10_000, stateIncomeTax: 9_000, propertyTaxes: 5_000,
          interestPaid: 6_000, otherItemized: 2_000, itemizedTotal: 28_000,
          standardDeduction: 30_000, taxDeductions: 30_000,
        },
      }),
    }),
    baseYear({
      year: 2031,
      ages: { client: 65, spouse: 61 },
      taxDetail: { qbi: 0 } as NonNullable<ProjectionYear["taxDetail"]>,
      taxResult: makeTaxResult({
        income: { taxableSocialSecurity: 30_000, ordinaryIncome: 50_000, totalIncome: 80_000, grossTotalIncome: 80_000 },
        flow: {
          aboveLineDeductions: 0, adjustedGrossIncome: 80_000, belowLineDeductions: 29_200,
          taxableIncome: 50_800, incomeTaxBase: 50_800, regularFederalIncomeTax: 5_700,
          fica: 0, stateTax: 1_560, totalFederalTax: 5_700, totalTax: 7_260,
        },
        diag: {
          marginalFederalRate: 0.12,
          marginalBracketTier: { from: 23_200, to: 94_300, rate: 0.12 },
          incomeBracketsForFiling: [
            { from: 0, to: 23_200, rate: 0.10 },
            { from: 23_200, to: 94_300, rate: 0.12 },
            { from: 94_300, to: null, rate: 0.22 },
          ],
        },
        state: { startingIncome: 80_000, stateAGI: 80_000, stateTaxableIncome: 50_800, stateTax: 1_560 },
      }),
      deductionBreakdown: makeDeductionBreakdown({
        belowLine: { standardDeduction: 29_200, itemizedTotal: 12_000, taxDeductions: 29_200 },
      }),
    }),
    baseYear({
      year: 2036,
      ages: { client: 70, spouse: 66 },
      taxDetail: { qbi: 0 } as NonNullable<ProjectionYear["taxDetail"]>,
      taxResult: makeTaxResult({
        income: { taxableSocialSecurity: 33_000, ordinaryIncome: 60_000, totalIncome: 93_000, grossTotalIncome: 93_000 },
        flow: {
          adjustedGrossIncome: 93_000, belowLineDeductions: 29_200, taxableIncome: 63_800,
          incomeTaxBase: 63_800, regularFederalIncomeTax: 7_300, stateTax: 1_960,
          totalFederalTax: 7_300, totalTax: 9_260,
        },
        diag: {
          marginalFederalRate: 0.12,
          marginalBracketTier: { from: 23_200, to: 94_300, rate: 0.12 },
          incomeBracketsForFiling: [
            { from: 0, to: 23_200, rate: 0.10 },
            { from: 23_200, to: 94_300, rate: 0.12 },
            { from: 94_300, to: null, rate: 0.22 },
          ],
        },
        state: { startingIncome: 93_000, stateAGI: 93_000, stateTaxableIncome: 63_800, stateTax: 1_960 },
      }),
      deductionBreakdown: makeDeductionBreakdown({
        belowLine: { standardDeduction: 29_200, taxDeductions: 29_200 },
      }),
    }),
  ];
}
