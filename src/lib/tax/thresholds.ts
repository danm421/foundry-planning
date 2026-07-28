/**
 * Income-driven threshold model — the single definition of every phase-out the
 * engine applies AND the status the Thresholds report renders.
 *
 * Pure: no Next, no @/db, no React. Both `src/engine/` and the solver import it.
 *
 * Three items do NOT test MAGI: QBI phases on taxable income before the QBI
 * deduction, the AMT exemption phases on AMTI, and the charitable limit is a
 * percentage of AGI. `ThresholdFacts` carries each income measure separately
 * rather than pretending one figure drives every row.
 */

import type { FilingStatus, TaxYearParameters } from "./types";
import { STATUTORY_FIXED, amtPhaseoutRate } from "./constants";

export type ThresholdStatus = "full" | "partial" | "out" | "na";

export type ThresholdItemId =
  | "charitableLimit" | "rothIra" | "iraDeductCovered" | "iraDeductSpousal"
  | "studentLoanInterest" | "qbi" | "amtExemption" | "niit"
  | "aotc" | "ctc" | "saversCredit";

export interface ThresholdRange {
  start: number;
  /** null for single-point thresholds (NIIT, charitable limit). */
  end: number | null;
}

/** Household shape driving applicability and, for CTC, the range width. */
export interface ThresholdHousehold {
  filingStatus: FilingStatus;
  qualifyingChildren: number;
  otherDependents: number;
  aotcStudents: number;
  hasStudentLoanInterest: boolean;
  hasRothContribution: boolean;
  hasTraditionalIraContribution: boolean;
  hasQbi: boolean;
  hasInvestmentIncome: boolean;
  coveredSelf: boolean;
  coveredSpouse: boolean;
}

/**
 * One year's resolved figures. Each MAGI excludes only its own deduction, per
 * IRC 219(g)(3)(A) and 221(b)(2)(C) — they are NOT interchangeable. The caller
 * computes them in a fixed order (see projection.ts); there is no circularity.
 */
export interface ThresholdFacts {
  year: number;
  params: TaxYearParameters;
  household: ThresholdHousehold;
  agi: number;
  magiForIraDeduction: number;
  magiForStudentLoan: number;
  magiForRoth: number;
  magiForCredits: number;
  taxableIncomeBeforeQbi: number;
  amti: number;
  netInvestmentIncome: number;
}

export interface ThresholdItem {
  id: ThresholdItemId;
  label: string;
}

/** Display order mirrors eMoney's report so the two read side by side. */
export const THRESHOLD_ITEMS: readonly ThresholdItem[] = [
  { id: "charitableLimit", label: "Qualified Charitable Contribution Limit" },
  { id: "rothIra", label: "Roth IRA Contribution" },
  { id: "iraDeductCovered", label: "IRA Contribution Deductibility - Covered Spouse" },
  { id: "iraDeductSpousal", label: "IRA Contribution Deductibility - Non-covered Spouse" },
  { id: "studentLoanInterest", label: "Student Loan Interest Deduction" },
  { id: "qbi", label: "TCJA QBI Deduction" },
  { id: "amtExemption", label: "AMT Exemption" },
  { id: "niit", label: "Net Investment Income Tax" },
  { id: "aotc", label: "American Opportunity Credit" },
  { id: "ctc", label: "Child Tax Credit" },
  { id: "saversCredit", label: "Saver's Credit" },
];

const isMfj = (fs: FilingStatus) => fs === "married_joint";
const isMfs = (fs: FilingStatus) => fs === "married_separate";

/** Sentinel for "this item has no computable range for this household/year". */
const NA_RANGE: ThresholdRange = { start: Number.NaN, end: null };
export const isNaRange = (r: ThresholdRange) => Number.isNaN(r.start);

/**
 * `year` drives the AMT exemption phase-out rate (25% pre-2026, 50% from 2026
 * per OBBBA §70106) — it CANNOT be read off `params.year`, which the resolver
 * sets to the SOURCE year when inflating an out-year forward.
 *
 * `household` is only consulted for `ctc`, whose range width depends on the
 * credit's size. Omit it and `ctc` returns "not applicable".
 */
export function rangeFor(
  item: ThresholdItemId,
  year: number,
  params: TaxYearParameters,
  filingStatus: FilingStatus,
  household?: ThresholdHousehold,
): ThresholdRange {
  const S = STATUTORY_FIXED;

  switch (item) {
    case "charitableLimit":
      // A percentage of AGI, not a dollar threshold. The report renders the
      // computed 60%-of-AGI ceiling; there is no phase-out range.
      return { start: 0.6, end: null };

    case "rothIra": {
      // IRC 408A(c)(3)(B): MFS is $0-$10,000, never indexed.
      if (isMfs(filingStatus)) return { start: S.mfsPhaseoutStart, end: S.mfsPhaseoutEnd };
      const p = params.rothPhaseout;
      const start = isMfj(filingStatus) ? p.startMfj : p.startSingle;
      const end = isMfj(filingStatus) ? p.endMfj : p.endSingle;
      return start == null || end == null ? NA_RANGE : { start, end };
    }

    case "iraDeductCovered": {
      if (isMfs(filingStatus)) return { start: S.mfsPhaseoutStart, end: S.mfsPhaseoutEnd };
      const p = params.iraDeduct;
      const start = isMfj(filingStatus) ? p.coveredStartMfj : p.coveredStartSingle;
      const end = isMfj(filingStatus) ? p.coveredEndMfj : p.coveredEndSingle;
      return start == null || end == null ? NA_RANGE : { start, end };
    }

    case "iraDeductSpousal": {
      // Only meaningful for a married filer whose spouse is covered.
      if (!isMfj(filingStatus)) return NA_RANGE;
      const { spousalStartMfj: start, spousalEndMfj: end } = params.iraDeduct;
      return start == null || end == null ? NA_RANGE : { start, end };
    }

    case "studentLoanInterest": {
      if (isMfs(filingStatus)) return NA_RANGE; // IRC 221(e)(2): disallowed outright
      const p = params.studentLoan;
      const start = isMfj(filingStatus) ? p.startMfj : p.startSingle;
      const end = isMfj(filingStatus) ? p.endMfj : p.endSingle;
      return start == null || end == null ? NA_RANGE : { start, end };
    }

    case "qbi": {
      const start = isMfj(filingStatus)
        ? params.qbi.thresholdMfj : params.qbi.thresholdSingleHohMfs;
      const range = isMfj(filingStatus)
        ? params.qbi.phaseInRangeMfj : params.qbi.phaseInRangeOther;
      return { start, end: start + range };
    }

    case "amtExemption": {
      const start = isMfj(filingStatus) ? params.amtPhaseoutStart.mfj
        : isMfs(filingStatus) ? params.amtPhaseoutStart.mfs
        : params.amtPhaseoutStart.singleHoh;
      const exemption = isMfj(filingStatus) ? params.amtExemption.mfj
        : isMfs(filingStatus) ? params.amtExemption.mfs
        : params.amtExemption.singleHoh;
      // The exemption is gone once phaseoutRate x (AMTI - start) equals it.
      return { start, end: start + exemption / amtPhaseoutRate(year) };
    }

    case "niit": {
      const start = isMfj(filingStatus) ? params.niitThreshold.mfj
        : isMfs(filingStatus) ? params.niitThreshold.mfs
        : params.niitThreshold.single;
      return { start, end: null };
    }

    case "aotc":
      if (isMfs(filingStatus)) return NA_RANGE;   // IRC 25A(g)(6): denied to MFS filers
      return isMfj(filingStatus)
        ? { start: S.aotcPhaseoutStartMfj, end: S.aotcPhaseoutEndMfj }
        : { start: S.aotcPhaseoutStartOther, end: S.aotcPhaseoutEndOther };

    case "ctc": {
      // IRC 24(b): $50 per $1,000 over. The width therefore depends on the
      // credit's SIZE, which depends on the household. Hardcoding $444,000
      // would be wrong for anyone without exactly one qualifying child.
      const perChild = params.ctc.perChild;
      const odc = params.ctc.odcPerDependent;
      if (household == null || perChild == null || odc == null) return NA_RANGE;
      const gross = household.qualifyingChildren * perChild
                  + household.otherDependents * odc;
      if (gross <= 0) return NA_RANGE;
      const start = isMfj(filingStatus)
        ? S.ctcPhaseoutThresholdMfj : S.ctcPhaseoutThresholdOther;
      const width = (gross / S.ctcReductionPerStep) * S.ctcReductionStep;
      return { start, end: start + width };
    }

    case "saversCredit": {
      const tiers = isMfj(filingStatus) ? params.saversCredit.mfj
        : filingStatus === "head_of_household" ? params.saversCredit.hoh
        : params.saversCredit.single;
      if (tiers.length === 0) return NA_RANGE;
      // "Starts phasing" = the top tier's ceiling; "gone" = the last ceiling.
      return { start: tiers[0].agiCeiling, end: tiers[tiers.length - 1].agiCeiling };
    }
  }
}

/** The income measure each item actually tests. */
function incomeFor(item: ThresholdItemId, f: ThresholdFacts): number {
  switch (item) {
    case "iraDeductCovered":
    case "iraDeductSpousal":      return f.magiForIraDeduction;
    case "studentLoanInterest":   return f.magiForStudentLoan;
    case "rothIra":               return f.magiForRoth;
    case "aotc":
    case "ctc":                   return f.magiForCredits;
    case "qbi":                   return f.taxableIncomeBeforeQbi;
    case "amtExemption":          return f.amti;
    case "niit":
    case "saversCredit":
    case "charitableLimit":       return f.agi;
  }
}

/** Whether this item can apply to this household at all. */
function applies(item: ThresholdItemId, f: ThresholdFacts): boolean {
  const h = f.household;
  switch (item) {
    case "rothIra":             return h.hasRothContribution;
    case "iraDeductCovered":    return h.hasTraditionalIraContribution && h.coveredSelf;
    case "iraDeductSpousal":    return h.hasTraditionalIraContribution
                                    && !h.coveredSelf && h.coveredSpouse;
    case "studentLoanInterest": return h.hasStudentLoanInterest
                                    && !isMfs(h.filingStatus);
    case "qbi":                 return h.hasQbi;
    case "niit":                return h.hasInvestmentIncome;
    case "aotc":                return h.aotcStudents > 0 && !isMfs(h.filingStatus);
    case "ctc":                 return h.qualifyingChildren > 0 || h.otherDependents > 0;
    case "saversCredit":        return f.year <= STATUTORY_FIXED.saversCreditLastYear;
    case "amtExemption":
    case "charitableLimit":     return true;
  }
}

export function statusFor(item: ThresholdItemId, f: ThresholdFacts): ThresholdStatus {
  if (!applies(item, f)) return "na";

  const range = rangeFor(item, f.year, f.params, f.household.filingStatus, f.household);
  if (isNaRange(range)) return "na";

  const income = incomeFor(item, f);

  // A percentage-of-AGI limit is never "phased out" — it always applies.
  if (item === "charitableLimit") return "full";

  // Point thresholds: below is clean, at-or-above means the tax/limit bites.
  if (range.end == null) return income >= range.start ? "out" : "full";

  if (income <= range.start) return "full";
  if (income >= range.end) return "out";
  return "partial";
}

/** Pub 590-A Worksheets 2-1/2-2: round the reduced limit UP to the nearest $10;
 *  if it lands above $0 but under $200, raise it to $200. */
function roundReducedLimit(reduced: number, ceiling: number): number {
  if (reduced <= 0) return 0;
  const rounded = Math.ceil(reduced / 10) * 10;
  return Math.min(ceiling, rounded < 200 ? 200 : rounded);
}

export function rothIraAllowedContribution(
  magi: number, ageBasedLimit: number, year: number,
  params: TaxYearParameters, filingStatus: FilingStatus,
): number {
  // No household argument: the Roth range never depends on one.
  const range = rangeFor("rothIra", year, params, filingStatus);
  if (isNaRange(range) || range.end == null) return ageBasedLimit; // unseeded: don't gate
  if (magi <= range.start) return ageBasedLimit;
  if (magi >= range.end) return 0;
  const fraction = (magi - range.start) / (range.end - range.start);
  return roundReducedLimit(ageBasedLimit * (1 - fraction), ageBasedLimit);
}

/**
 * IRC 219(g)(1): the phase-out only applies when the taxpayer or their spouse
 * is an active participant in a workplace retirement plan — neither covered
 * means the full contribution is deductible with no MAGI limit at all.
 *
 * `rangeFor("iraDeductSpousal", …)` returns NA_RANGE for every non-MFJ filing
 * status (IRC 219(g)(7)'s spousal exception applies only to a joint return —
 * the paragraph says so explicitly). That NA means "genuinely inapplicable
 * here," never "unseeded" — so it must NOT be read as "don't gate." Per Pub
 * 590-A, a non-covered MFS filer whose spouse IS covered isn't exempt from
 * the phase-out: IRC 219(g)(1) triggers on either spouse being covered, and
 * 219(g)(3)(B)(iii) then fixes the MFS range at the same narrow $0-$10,000
 * band as a covered MFS filer, regardless of which spouse is the one covered.
 * `rangeFor("iraDeductCovered", …)` already returns that narrow band for MFS
 * unconditionally (see its own isMfs short-circuit), so MFS is routed there
 * — decided on filing status alone, never inferred from the sentinel.
 */
export function traditionalIraDeductibleAmount(
  magi: number, contribution: number, coveredSelf: boolean, coveredSpouse: boolean,
  year: number, params: TaxYearParameters, filingStatus: FilingStatus,
): number {
  if (!coveredSelf && !coveredSpouse) return contribution;

  const item: ThresholdItemId =
    coveredSelf || isMfs(filingStatus) ? "iraDeductCovered" : "iraDeductSpousal";
  const range = rangeFor(item, year, params, filingStatus);
  // Every remaining path here (covered-MFJ/single/HOH, spousal-MFJ) reads a
  // nullable params column — an NA reaching this point always means "not
  // seeded yet," since the genuinely-inapplicable non-MFJ spousal case was
  // already routed away above.
  if (isNaRange(range) || range.end == null) return contribution;
  if (magi <= range.start) return contribution;
  if (magi >= range.end) return 0;
  const fraction = (magi - range.start) / (range.end - range.start);
  return roundReducedLimit(contribution * (1 - fraction), contribution);
}

/**
 * IRC 221(e)(2) disallows the deduction outright for MFS filers — decided
 * BEFORE consulting `rangeFor` at all. `rangeFor("studentLoanInterest", …)`
 * also returns NA_RANGE for MFS, using the SAME sentinel that unseeded
 * params produce elsewhere; reading that NA as "unseeded, don't gate" would
 * hand an MFS filer the full deduction Congress denies them — exactly
 * backwards. Only once MFS is ruled out does a later NA mean "unseeded."
 */
export function studentLoanInterestDeduction(
  interestPaid: number, magi: number, year: number,
  params: TaxYearParameters, filingStatus: FilingStatus,
): number {
  if (isMfs(filingStatus)) return 0;

  // Never treat a null cap as $0 — that would silently zero a real deduction.
  const cap = params.studentLoan.maxDeduction;
  const capped = cap == null ? interestPaid : Math.min(interestPaid, cap);

  const range = rangeFor("studentLoanInterest", year, params, filingStatus);
  // MFS (the only genuinely-inapplicable case) was already ruled out above,
  // so any NA reaching here can only mean "not seeded yet" — don't gate.
  if (isNaRange(range) || range.end == null) return capped;
  if (magi <= range.start) return capped;
  if (magi >= range.end) return 0;
  const fraction = (magi - range.start) / (range.end - range.start);
  return capped * (1 - fraction); // linear, no rounding — Pub 590-A's $10 rule is IRA-specific
}
