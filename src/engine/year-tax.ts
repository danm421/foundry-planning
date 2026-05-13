import type {
  CharityCarryforward,
  DeductionBreakdown,
  PlanSettings,
  ProjectionYear,
} from "./types";
import type { TaxResult, TaxYearParameters } from "../lib/tax/types";
import type { CharityBucket } from "./charitable-deduction";
import { calculateTaxYearBracket, calculateTaxYearFlat, makeEmptyTaxParams } from "./tax";
import { computeCharitableDeductionForYear } from "./charitable-deduction";

export interface YearTaxInput {
  /** taxDetail with all scheduled income + (optionally) supplemental withdrawal income layered in */
  taxDetail: NonNullable<ProjectionYear["taxDetail"]>;
  /** for SS gross used by bracket SS taxability */
  socialSecurityGross: number;
  /** for the Math.max(0, income.total - taxableIncome) flat-mode non-taxable line */
  totalIncome: number;
  taxableIncome: number;
  filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household";
  year: number;
  planSettings: PlanSettings;
  /** resolved tax params + inflation factor for this year (or null in flat-only mode) */
  resolved: { params: TaxYearParameters; inflationFactor: number } | null;
  useBracket: boolean;
  /** above-line deductions excluding SECA half (added internally) */
  aboveLineDeductions: number;
  /** itemized deductions excluding charity-this-year (added internally via charityResult) */
  itemizedDeductions: number;
  /** prior-year carryforward (mutable across years; output returns the new state) */
  charityCarryforwardIn: CharityCarryforward;
  /** charity gifts to apply this year, bucketed */
  charityGiftsThisYear: { amount: number; bucket: CharityBucket }[];
  /** SECA result (already computed upstream) */
  secaResult: { seTax: number; deductibleHalf: number };
  /** transfer early-withdrawal penalty (rolled into total tax) */
  transferEarlyWithdrawalPenalty: number;
  /** realization OI to peel out of ordinaryIncome for NIIT interest classification */
  interestIncomeForTax: number;
  /** deduction breakdown computed upstream — included in output untouched plus charity patch */
  deductionBreakdownIn: DeductionBreakdown | null;
  /** Retirement income breakdown for state income tax exclusion rules.
   *  Built in projection.ts from taxDetail.bySource + accountById/incomeById.
   *  Optional — defaults to all-zero when absent (pre-G1 callers). */
  retirementBreakdown?: {
    db: number;
    ira: number;
    k401: number;
    annuity: number;
  };
  /** Ages at projection year, for state retirement-exclusion age thresholds. */
  primaryAge?: number;
  spouseAge?: number;
}

export interface YearTaxOutput {
  taxResult: TaxResult;
  /** taxResult.flow.totalTax post adjustments (transfer penalty + SECA already added) */
  taxes: number;
  /** diagnostic only — not used for gross-up after the F5 refactor */
  marginalFedRate: number;
  marginalCombinedRate: number;
  /** new carryforward state (advances year-to-year) */
  charityCarryforwardOut: CharityCarryforward;
  /** deduction breakdown (charity-patched if charity deducted this year) */
  deductionBreakdown: DeductionBreakdown | null;
  /** charity AGI used (diagnostic) */
  charityAgi: number;
  /** charity deductionThisYear (diagnostic) */
  charityDeductionThisYear: number;
}

export function computeTaxForYear(input: YearTaxInput): YearTaxOutput {
  const {
    taxDetail, socialSecurityGross, totalIncome, taxableIncome,
    filingStatus, year, planSettings, resolved, useBracket,
    aboveLineDeductions, itemizedDeductions: itemizedIn,
    charityCarryforwardIn, charityGiftsThisYear, secaResult,
    transferEarlyWithdrawalPenalty, interestIncomeForTax, deductionBreakdownIn,
    retirementBreakdown, primaryAge, spouseAge,
  } = input;

  // Deductible-half-of-SE-tax is an above-the-line adjustment per §164(f).
  const aboveLineWithSeca = aboveLineDeductions + secaResult.deductibleHalf;

  // Approximate AGI for §170(b) bucket math (exact AGI is computed inside calculateTaxYearBracket).
  const charityAgi = Math.max(0, taxableIncome - aboveLineWithSeca);
  const willItemize = useBracket
    ? itemizedIn > (resolved?.params.stdDeduction[filingStatus] ?? 0)
    : false;

  const charityResult = computeCharitableDeductionForYear({
    giftsThisYear: charityGiftsThisYear,
    agi: charityAgi,
    carryforwardIn: charityCarryforwardIn,
    currentYear: year,
    willItemize,
  });

  const itemizedDeductions = itemizedIn + charityResult.deductionThisYear;

  // Patch deduction breakdown for charity (mirrors projection.ts:1703-1715)
  let deductionBreakdownOut = deductionBreakdownIn;
  if (deductionBreakdownIn && charityResult.deductionThisYear > 0) {
    const newCharitable = deductionBreakdownIn.belowLine.charitable + charityResult.deductionThisYear;
    const newItemizedTotal = deductionBreakdownIn.belowLine.itemizedTotal + charityResult.deductionThisYear;
    deductionBreakdownOut = {
      ...deductionBreakdownIn,
      belowLine: {
        ...deductionBreakdownIn.belowLine,
        charitable: newCharitable,
        itemizedTotal: newItemizedTotal,
        taxDeductions: Math.max(newItemizedTotal, deductionBreakdownIn.belowLine.standardDeduction),
      },
    };
  }

  const taxResult = useBracket
    ? calculateTaxYearBracket({
        year, filingStatus,
        earnedIncome: taxDetail.earnedIncome,
        ordinaryIncome: Math.max(0, taxDetail.ordinaryIncome - interestIncomeForTax),
        interestIncome: interestIncomeForTax,
        qualifiedDividends: taxDetail.dividends,
        longTermCapitalGains: taxDetail.capitalGains,
        shortTermCapitalGains: taxDetail.stCapitalGains,
        qbiIncome: taxDetail.qbi,
        taxExemptIncome: taxDetail.taxExempt,
        socialSecurityGross,
        aboveLineDeductions: aboveLineWithSeca,
        itemizedDeductions,
        flatStateRate: planSettings.flatStateRate,
        taxParams: resolved!.params,
        inflationFactor: resolved!.inflationFactor,
        retirementBreakdown,
        residenceState: planSettings.residenceState,
        primaryAge,
        spouseAge,
      })
    : calculateTaxYearFlat({
        taxableIncome,
        flatFederalRate: planSettings.flatFederalRate,
        flatStateRate: planSettings.flatStateRate,
        taxParams: resolved?.params ?? makeEmptyTaxParams(year),
        nonTaxableIncome: Math.max(0, totalIncome - taxableIncome),
      });

  // Add transfer early-withdrawal penalty
  if (transferEarlyWithdrawalPenalty > 0) {
    taxResult.flow.totalTax += transferEarlyWithdrawalPenalty;
    taxResult.flow.totalFederalTax += transferEarlyWithdrawalPenalty;
  }
  // Add SECA tax (federal payroll)
  if (secaResult.seTax > 0) {
    taxResult.flow.totalTax += secaResult.seTax;
    taxResult.flow.totalFederalTax += secaResult.seTax;
  }

  const marginalFedRate = useBracket ? taxResult.diag.marginalFederalRate : planSettings.flatFederalRate;
  const marginalCombinedRate = Math.min(0.99, marginalFedRate + planSettings.flatStateRate);

  return {
    taxResult,
    taxes: taxResult.flow.totalTax,
    marginalFedRate,
    marginalCombinedRate,
    charityCarryforwardOut: charityResult.carryforwardOut,
    deductionBreakdown: deductionBreakdownOut,
    charityAgi,
    charityDeductionThisYear: charityResult.deductionThisYear,
  };
}
