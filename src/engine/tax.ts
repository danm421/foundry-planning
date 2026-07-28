// src/engine/tax.ts
//
// Two tax-calculation paths, both returning the same TaxResult shape so the
// drill-down UI works identically:
//   - calculateTaxYearFlat: legacy flat-rate (federal + state percent × taxable income)
//   - calculateTaxYearBracket: full bracket engine (re-exported from lib/tax)
//
// Routing happens in projection.ts based on planSettings.taxEngineMode.

import type { PlanSettings } from "./types";
import type { TaxResult, TaxYearParameters, BracketTier, FilingStatus } from "../lib/tax/types";
import { calculateTaxYear as calculateTaxYearBracket } from "../lib/tax/calculate";
import {
  netCapitalGainsAndLosses,
  computeCarryforwardOut,
  emptyCapitalLossCarryforward,
} from "../lib/tax/capital-loss";

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
  /** Prior-year carryforward. Consumed by the §1222/§1211(b)/§1212(b) netting
   *  below exactly as in bracket mode. */
  capitalLossCarryforwardIn?: import("../lib/tax/capital-loss").CapitalLossCarryforward;
  /** SIGNED gross LONG-term capital gain **already folded into
   *  `taxableIncome`** by the caller. Not the year's "true" LT gain — the two
   *  differ (a non-grantor trust's share, a CRT's share, note-receivable
   *  principal and education-draw gains all move `taxDetail.capitalGains`
   *  without moving the flat scalar). It is the folded figure that must be
   *  backed out here, or the adjustment corrupts the base it is applied to. */
  longTermCapitalGains: number;
  /** SIGNED gross SHORT-term capital gain already folded into `taxableIncome`.
   *  Same contract as `longTermCapitalGains`. */
  shortTermCapitalGains: number;
  filingStatus: FilingStatus;
}

/**
 * Flat-mode tax calculator. Returns same TaxResult shape as the bracket engine
 * but populates only the high-level totals.
 *
 * §1222 netting → §1211(b) cap → §1212(b) carryforward run here too. Flat is
 * the DEFAULT tax mode, and without this a realized capital loss offset
 * ordinary income dollar-for-dollar through `Math.max(0, taxableIncome)`:
 * $400k of salary plus a $500k below-basis sale produced $0 of tax instead of
 * ~$115,130.
 */
export function calculateTaxYearFlat(input: FlatCalcInput): TaxResult {
  const netting = netCapitalGainsAndLosses({
    longTermGain: input.longTermCapitalGains,
    shortTermGain: input.shortTermCapitalGains,
    carryforwardIn: input.capitalLossCarryforwardIn ?? emptyCapitalLossCarryforward(),
    filingStatus: input.filingStatus,
  });

  // Swap the raw signed pair the caller folded in for the netted pair, then
  // take the capped §1211(b) offset. Arithmetically a no-op whenever the year
  // has no loss and no incoming carryforward (netting returns the inputs
  // unchanged and a zero deduction), which is what keeps gain-only and
  // no-capital-activity years byte-identical to the pre-netting behaviour.
  const adjustedTaxable =
    input.taxableIncome
    - input.longTermCapitalGains
    - input.shortTermCapitalGains
    + netting.netLongTermGain
    + netting.netShortTermGain
    - netting.capitalLossDeduction;

  // §1212(b)(2) consumption test wants taxable income computed as if the
  // deduction had NOT been taken, and UNFLOORED — see the contract on
  // `computeCarryforwardOut`. Pass the pre-floor figure, not `safeTaxable`.
  const { carryforwardOut, carryforwardConsumed } = computeCarryforwardOut(
    netting,
    adjustedTaxable + netting.capitalLossDeduction,
  );

  const safeTaxable = Math.max(0, adjustedTaxable);
  // Report the netted gains rather than stub zeros. `ordinaryIncome` carries
  // the non-LT residual (mirroring bracket mode, where net STCG lives inside
  // ordinaryIncome) so the two consumers that render
  // `ordinaryIncome − shortCapitalGains` — tax-detail-income-table.tsx and the
  // income-tax presentation view-model — stay non-negative and the row still
  // sums to `totalIncome`. Both are clamped to `safeTaxable` for the
  // degenerate case where the floor bites.
  const reportedLongTerm = Math.min(netting.netLongTermGain, safeTaxable);
  const reportedShortTerm = Math.min(
    netting.netShortTermGain,
    safeTaxable - reportedLongTerm,
  );
  const federal = safeTaxable * input.flatFederalRate;
  const state = safeTaxable * input.flatStateRate;
  const total = federal + state;
  const nonTaxableIncome = Math.max(0, input.nonTaxableIncome ?? 0);
  return {
    income: {
      earnedIncome: 0,
      taxableSocialSecurity: 0,
      ordinaryIncome: safeTaxable - reportedLongTerm,
      dividends: 0,
      capitalGains: reportedLongTerm,
      shortCapitalGains: reportedShortTerm,
      qbi: 0,
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
      earlyWithdrawalPenalty: 0,
    },
    diag: {
      marginalFederalRate: input.flatFederalRate,
      // Flat-rate fallback has no real bracket structure; synthesize a single
      // open-ended tier so consumers reading marginalBracketTier still work.
      marginalBracketTier: { from: 0, to: null, rate: input.flatFederalRate },
      incomeBracketsForFiling: [{ from: 0, to: null, rate: input.flatFederalRate }],
      effectiveFederalRate: input.flatFederalRate,
      bracketsUsed: input.taxParams,
      inflationFactor: 1.0,
    },
    capitalLoss: {
      deduction: netting.capitalLossDeduction,
      carryforwardConsumed,
      // Always a fresh object (computeCarryforwardOut builds one) — a year-loop
      // that mutates carryforwardOut must never corrupt the caller's
      // input.capitalLossCarryforwardIn.
      carryforwardOut,
      shortTermLoss: netting.shortTermLoss,
      longTermLoss: netting.longTermLoss,
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
    trustIncomeBrackets: [],
    trustCapGainsBrackets: [],
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
