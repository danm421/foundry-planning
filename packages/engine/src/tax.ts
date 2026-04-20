// src/engine/tax.ts
//
// Two tax-calculation paths, both returning the same TaxResult shape so the
// drill-down UI works identically:
//   - calculateTaxYearFlat: legacy flat-rate (federal + state percent × taxable income)
//   - calculateTaxYearBracket: full bracket engine (re-exported from lib/tax)
//
// Routing happens in projection.ts based on planSettings.taxEngineMode.

import type { PlanSettings } from "./types";
import type { TaxResult, TaxYearParameters, BracketTier, FilingStatus } from "./lib/tax/types";
import { calculateTaxYear as calculateTaxYearBracket } from "./lib/tax/calculate";

export { calculateTaxYearBracket };

export interface FlatCalcInput {
  taxableIncome: number;
  flatFederalRate: number;
  flatStateRate: number;
  taxParams: TaxYearParameters;
  /** Tax-exempt income (muni bond interest, Roth distributions, etc.).
   *  When provided, rolls into `nonTaxableIncome` and `grossTotalIncome` so
   *  the tax-detail UI columns reflect the client's actual non-taxable flows
   *  rather than reading as stub zeros. */
  nonTaxableIncome?: number;
}

/**
 * Flat-mode tax calculator. Returns same TaxResult shape as the bracket engine
 * but populates only the high-level totals.
 */
export function calculateTaxYearFlat(input: FlatCalcInput): TaxResult {
  const safeTaxable = Math.max(0, input.taxableIncome);
  const federal = safeTaxable * input.flatFederalRate;
  const state = safeTaxable * input.flatStateRate;
  const total = federal + state;
  const nonTaxableIncome = Math.max(0, input.nonTaxableIncome ?? 0);
  return {
    income: {
      earnedIncome: 0,
      taxableSocialSecurity: 0,
      ordinaryIncome: 0,
      dividends: 0,
      capitalGains: 0,
      shortCapitalGains: 0,
      totalIncome: safeTaxable,
      nonTaxableIncome,
      grossTotalIncome: safeTaxable + nonTaxableIncome,
    },
    flow: {
      aboveLineDeductions: 0,
      adjustedGrossIncome: safeTaxable,
      qbiDeduction: 0,
      belowLineDeductions: 0,
      taxableIncome: safeTaxable,
      incomeTaxBase: safeTaxable,
      regularTaxCalc: federal,
      amtCredit: 0,
      taxCredits: 0,
      regularFederalIncomeTax: federal,
      capitalGainsTax: 0,
      amtAdditional: 0,
      niit: 0,
      additionalMedicare: 0,
      fica: 0,
      stateTax: state,
      totalFederalTax: federal,
      totalTax: total,
    },
    diag: {
      marginalFederalRate: input.flatFederalRate,
      effectiveFederalRate: input.flatFederalRate,
      bracketsUsed: input.taxParams,
      inflationFactor: 1.0,
    },
  };
}

/**
 * Legacy entry point — preserves the old `calculateTaxes(taxableIncome, settings) → number`
 * API for any non-projection callers. Internally uses the flat path.
 */
export function calculateTaxes(taxableIncome: number, settings: PlanSettings): number {
  if (taxableIncome <= 0) return 0;
  return taxableIncome * (Number(settings.flatFederalRate) + Number(settings.flatStateRate));
}

// Stub used when tax_year_parameters rows aren't available — provides a
// placeholder shape for diag fields without crashing.
const ZERO_TIER: BracketTier = { from: 0, to: null, rate: 0 };
const ZERO_BRACKETS: Record<FilingStatus, BracketTier[]> = {
  married_joint: [ZERO_TIER],
  single: [ZERO_TIER],
  head_of_household: [ZERO_TIER],
  married_separate: [ZERO_TIER],
};
const ZERO_CG = { zeroPctTop: 0, fifteenPctTop: 0 };

export function makeEmptyTaxParams(year: number): TaxYearParameters {
  return {
    year,
    incomeBrackets: ZERO_BRACKETS,
    capGainsBrackets: {
      married_joint: ZERO_CG,
      single: ZERO_CG,
      head_of_household: ZERO_CG,
      married_separate: ZERO_CG,
    },
    stdDeduction: { married_joint: 0, single: 0, head_of_household: 0, married_separate: 0 },
    amtExemption: { mfj: 0, singleHoh: 0, mfs: 0 },
    amtBreakpoint2628: { mfjShoh: 0, mfs: 0 },
    amtPhaseoutStart: { mfj: 0, singleHoh: 0, mfs: 0 },
    ssTaxRate: 0, ssWageBase: 0, medicareTaxRate: 0, addlMedicareRate: 0,
    addlMedicareThreshold: { mfj: 0, single: 0, mfs: 0 },
    niitRate: 0, niitThreshold: { mfj: 0, single: 0, mfs: 0 },
    qbi: { thresholdMfj: 0, thresholdSingleHohMfs: 0, phaseInRangeMfj: 0, phaseInRangeOther: 0 },
    contribLimits: {
      ira401kElective: 0, ira401kCatchup50: 0, ira401kCatchup6063: null,
      iraTradLimit: 0, iraCatchup50: 0,
      simpleLimitRegular: 0, simpleCatchup50: 0,
      hsaLimitSelf: 0, hsaLimitFamily: 0, hsaCatchup55: 0,
    },
  };
}
