import type {
  CharityCarryforward,
  DeductionBreakdown,
  PlanSettings,
  ProjectionYear,
} from "./types";
import type { TaxResult, TaxYearParameters } from "../lib/tax/types";
import type { CharityBucket } from "./charitable-deduction";
import { calculateTaxYearBracket, calculateTaxYearFlat, makeEmptyTaxParams } from "./tax";
import { computeCharitableDeductionForYear, computeCharitableNoItemize } from "./charitable-deduction";
import { getAdditionalStdDeduction } from "../lib/tax/senior-deductions";

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
  /** SECA result (already computed upstream). `additionalMedicare` is the
   *  SE-side 0.9% surtax (IRC §1401(b)(2)) — added to flow.additionalMedicare
   *  and the federal/total tax here alongside seTax. */
  secaResult: { seTax: number; deductibleHalf: number; additionalMedicare?: number };
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
  /** Household-grantor 529 contributions this year, for the state 529
   *  deduction/credit. Built in projection.ts from the savings pass. Optional —
   *  absent ⇒ no 529 benefit. */
  contrib529?: { total: number; byBeneficiary: number[] };
  /** Ages at projection year, for state retirement-exclusion age thresholds. */
  primaryAge?: number;
  spouseAge?: number;
  /** ISO exercise bargain element for the year — flows to AMTI (bracket mode). */
  isoSpread?: number;
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
    retirementBreakdown, contrib529, primaryAge, spouseAge, isoSpread,
  } = input;

  // Deductible-half-of-SE-tax is an above-the-line adjustment per §164(f).
  const aboveLineWithSeca = aboveLineDeductions + secaResult.deductibleHalf;

  // Approximate AGI for §170(b) bucket math (exact AGI is computed inside calculateTaxYearBracket).
  const charityAgi = Math.max(0, taxableIncome - aboveLineWithSeca);
  // F23: the itemize-vs-standard election must compare (existing itemized + THIS
  // YEAR's candidate charitable deduction) against the standard deduction. The
  // threshold must match calculate.ts: include the §63(f) additional standard
  // deduction for 65+ filers (the standard path is what we'd fall back to).
  const baseStd = resolved?.params.stdDeduction[filingStatus] ?? 0;
  const effectiveStd =
    baseStd +
    getAdditionalStdDeduction(
      year,
      filingStatus,
      primaryAge ?? 0,
      spouseAge,
      resolved?.inflationFactor ?? 1,
    );

  // Candidate charity deduction assuming we itemize — drives the election. The
  // election uses the UN-floored candidate; the F22 floor (below) is a deduction
  // haircut applied only after we've committed to itemizing, not an election input.
  const candidate = computeCharitableDeductionForYear({
    giftsThisYear: charityGiftsThisYear,
    agi: charityAgi,
    carryforwardIn: charityCarryforwardIn,
    currentYear: year,
  });

  const willItemize = useBracket
    ? itemizedIn + candidate.deductionThisYear > effectiveStd
    : false;

  // Commit the matching branch. When standard wins, no carryforward is consumed —
  // prior entries only decay/expire and this year's gifts are appended (F23 fix).
  const charityResult = willItemize
    ? candidate
    : computeCharitableNoItemize({
        giftsThisYear: charityGiftsThisYear,
        carryforwardIn: charityCarryforwardIn,
        currentYear: year,
      });

  // F22 / OBBBA §170(b)(1)(I): 0.5%-of-AGI floor on ITEMIZED charitable
  // contributions, effective tax years beginning after 2025 (i.e. 2026+).
  //
  // Statutory carryforward rule — IRC §170(d)(1)(C): the amount disallowed by
  // the 0.5%-AGI floor carries forward ONLY to the extent the taxpayer also has
  // a percentage-limitation (60%/30%/20% AGI-ceiling) carryover for that year;
  // absent such a ceiling carryover, the floored amount is permanently LOST.
  // This engine always treats the floored amount as lost — exact for the common
  // case (gift within the AGI ceiling, no ceiling carryover) and a conservative
  // simplification for the over-ceiling case (it understates the future
  // carryforward, so it can only understate a future deduction, never overstate).
  //
  // TODO / known limitation: when an AGI-ceiling carryover exists, the floored
  // amount should be preserved (up to that carryover) rather than dropped. Not
  // yet modeled — see §170(d)(1)(C).
  let charityDeductionThisYear = charityResult.deductionThisYear;
  if (willItemize && year >= 2026 && charityDeductionThisYear > 0) {
    const floor = 0.005 * charityAgi;
    charityDeductionThisYear = Math.max(0, charityDeductionThisYear - floor);
  }

  const itemizedDeductions = itemizedIn + charityDeductionThisYear;

  // Patch deduction breakdown for charity (mirrors projection.ts:1703-1715).
  // Uses the floored amount (F22) so the breakdown matches the deduction taken.
  let deductionBreakdownOut = deductionBreakdownIn;
  if (deductionBreakdownIn && charityDeductionThisYear > 0) {
    const newCharitable = deductionBreakdownIn.belowLine.charitable + charityDeductionThisYear;
    const newItemizedTotal = deductionBreakdownIn.belowLine.itemizedTotal + charityDeductionThisYear;
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
        // Narrow muni-only subset for the §86 SS combined-income test (mirrors the
        // IRMAA-MAGI bucket); the broad taxExempt total still feeds income display.
        taxExemptInterest: taxDetail.taxExemptInterest,
        socialSecurityGross,
        aboveLineDeductions: aboveLineWithSeca,
        itemizedDeductions,
        flatStateRate: planSettings.flatStateRate,
        taxParams: resolved!.params,
        inflationFactor: resolved!.inflationFactor,
        retirementBreakdown,
        contrib529,
        residenceState: planSettings.residenceState,
        primaryAge,
        spouseAge,
        isoSpread: isoSpread ?? 0,
        // F7: itemized SALT (Schedule A line 7, post-§164 cap) is disallowed for AMT
        // (IRC §56(b)(1)(A)(ii)) → added back to AMTI for itemizers. The breakdown's
        // taxesPaid is already the capped total (Math.min(rawSalt, saltCap)).
        saltDeducted: deductionBreakdownOut?.belowLine.taxesPaid ?? 0,
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
    taxResult.flow.earlyWithdrawalPenalty += transferEarlyWithdrawalPenalty;
    taxResult.flow.totalTax += transferEarlyWithdrawalPenalty;
    taxResult.flow.totalFederalTax += transferEarlyWithdrawalPenalty;
  }
  // Add SECA tax (federal payroll)
  if (secaResult.seTax > 0) {
    taxResult.flow.totalTax += secaResult.seTax;
    taxResult.flow.totalFederalTax += secaResult.seTax;
  }
  // Add SE-side 0.9% Additional Medicare surtax (IRC §1401(b)(2)). The
  // wage-side surtax is already inside taxResult.flow.additionalMedicare /
  // totalFederalTax / totalTax (computed in calculateTaxYearBracket); the
  // SE-side base is threshold-coordinated upstream so there's no double-count.
  const seAdditionalMedicare = secaResult.additionalMedicare ?? 0;
  if (seAdditionalMedicare > 0) {
    taxResult.flow.additionalMedicare += seAdditionalMedicare;
    taxResult.flow.totalTax += seAdditionalMedicare;
    taxResult.flow.totalFederalTax += seAdditionalMedicare;
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
    charityDeductionThisYear,
  };
}
