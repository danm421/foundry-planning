import type {
  CharityCarryforward,
  DeductionBreakdown,
  PlanSettings,
  ProjectionYear,
} from "./types";
import type { TaxResult, TaxYearParameters } from "../lib/tax/types";
import type { CharityBucket } from "./charitable-deduction";

export interface YearTaxInput {
  /** taxDetail with all scheduled income + (optionally) supplemental withdrawal income layered in */
  taxDetail: ProjectionYear["taxDetail"];
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

export function computeTaxForYear(_input: YearTaxInput): YearTaxOutput {
  throw new Error("computeTaxForYear: not implemented yet (Task 5)");
}
