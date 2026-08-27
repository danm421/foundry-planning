/**
 * Income-driven threshold model — the single definition of every phase-out the
 * engine applies AND the status the Thresholds report renders.
 *
 * Pure: no Next, no @/db, no React. Both `src/engine/` and the solver import it.
 *
 * Three items do NOT test MAGI: QBI phases on taxable income before the QBI
 * deduction, the AMT exemption phases on AMTI, and the charitable limit is a
 * percentage of AGI. A fourth, `amt`, tests no income at all — it reports the
 * settled AMT charge. `ThresholdFacts` carries each measure separately rather
 * than pretending one figure drives every row.
 */

import type { FilingStatus, TaxYearParameters } from "./types";
import { STATUTORY_FIXED, amtPhaseoutRate } from "./constants";
import { amtApplies } from "./amt";

export type ThresholdStatus = "full" | "partial" | "out" | "na";

export type ThresholdItemId =
  | "charitableLimit" | "rothIra" | "iraDeductCovered" | "iraDeductSpousal"
  | "studentLoanInterest" | "qbi" | "amtExemption" | "amt" | "niit"
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
  /** Whether the household made any IRC 25B-eligible contribution — elective
   *  deferrals plus IRA contributions, the SAME sum `computeSaversCredit`
   *  multiplies by the tier rate. Without it the Saver's row is the only
   *  contribution-driven item with no household gate, and reads "Full" at a
   *  qualifying AGI for a household the credit layer pays $0. */
  hasRetirementContributions: boolean;
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
  /** The settled AMT charge for the year — tentative minimum tax less regular
   *  tax, floored at zero (`TaxResult.flow.amtAdditional`). The ONLY field here
   *  that is not an income measure, because the `amt` row is not an income
   *  threshold: AMT bites when one tax computation exceeds another, at any
   *  income. Read through `amtApplies()` so this row and every other AMT
   *  surface agree on what counts as an AMT year. */
  amtAdditional: number;
}

export interface ThresholdItem {
  id: ThresholdItemId;
  label: string;
  /**
   * What "out" MEANS for this row, and therefore how it must be labelled.
   *
   *  - `benefit`: something desirable phases away as income rises. "Full" is
   *    good news, "Phased Out" is bad news — the generic labels are correct.
   *  - `burden`: a tax or surtax that BITES once the row goes "out". The
   *    generic labels read exactly backwards, so the renderer MUST carry a
   *    per-item override (pinned by a guard test in the solver panel's suite).
   *
   * Declared here rather than inferred from the shape of `rangeFor`'s result:
   * the old inference ("a point threshold is a burden") could not see `amt`,
   * whose range is the NA sentinel because it has no income threshold at all.
   */
  kind: "benefit" | "burden";
}

/** Display order mirrors eMoney's report so the two read side by side, with
 *  `amt` inserted directly beneath `amtExemption` — the exemption row reports
 *  only whether the exemption survived, and read alone its green "Full" was
 *  taken as a verdict on AMT itself. */
export const THRESHOLD_ITEMS: readonly ThresholdItem[] = [
  { id: "charitableLimit", label: "Qualified Charitable Contribution Limit", kind: "benefit" },
  { id: "rothIra", label: "Roth IRA Contribution", kind: "benefit" },
  { id: "iraDeductCovered", label: "IRA Contribution Deductibility - Covered Spouse", kind: "benefit" },
  { id: "iraDeductSpousal", label: "IRA Contribution Deductibility - Non-covered Spouse", kind: "benefit" },
  { id: "studentLoanInterest", label: "Student Loan Interest Deduction", kind: "benefit" },
  { id: "qbi", label: "TCJA QBI Deduction", kind: "benefit" },
  { id: "amtExemption", label: "AMT Exemption", kind: "benefit" },
  { id: "amt", label: "Alternative Minimum Tax", kind: "burden" },
  { id: "niit", label: "Net Investment Income Tax", kind: "burden" },
  { id: "aotc", label: "American Opportunity Credit", kind: "benefit" },
  { id: "ctc", label: "Child Tax Credit", kind: "benefit" },
  { id: "saversCredit", label: "Saver's Credit", kind: "benefit" },
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

    case "amt":
      // AMT has no income threshold to render. It is owed when the tentative
      // minimum tax exceeds the regular tax, which depends on the MIX of
      // income and preferences, not on a level of either — two households at
      // the same AMTI can land on opposite sides. The report prints its
      // "no computable range" em-dash rather than inventing a figure, and
      // `statusFor` settles this row before it ever consults a range.
      return NA_RANGE;

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

/** The income measure each item actually tests. The two rangeless rows are
 *  excluded at the TYPE level rather than given cases: `statusFor` settles both
 *  before reaching this, and a case here would be an unreachable claim that
 *  some income measure decides them. (`charitableLimit` used to have one, and
 *  its `f.agi` was computed and then thrown away.) */
function incomeFor(
  item: Exclude<ThresholdItemId, "amt" | "charitableLimit">,
  f: ThresholdFacts,
): number {
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
    case "saversCredit":          return f.agi;
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
    // IRC 25B pays a percentage OF the contribution, so no contribution is no
    // credit at any AGI — the same reason `rothIra` and the two `iraDeduct`
    // rows are contribution-gated. The SECURE 2.0 §103 sunset is a second,
    // independent reason the row can go dark.
    case "saversCredit":        return h.hasRetirementContributions
                                    && f.year <= STATUTORY_FIXED.saversCreditLastYear;
    // No household fact switches AMT off: any filer can owe it. A `hasX` gate
    // here would re-create the defect this row exists to fix, in a new shape.
    case "amt":
    case "amtExemption":
    case "charitableLimit":     return true;
  }
}

export function statusFor(item: ThresholdItemId, f: ThresholdFacts): ThresholdStatus {
  if (!applies(item, f)) return "na";

  // The two rows that are NOT "an income measure against a range", settled
  // together and BEFORE the range lookup so there is one precedent to copy
  // rather than two at different depths. Returning from this switch also
  // narrows `item` for `incomeFor` below, so neither row can be handed an
  // income measure that would not decide it.
  switch (item) {
    // AMT is a verdict on a completed tax computation, not a threshold
    // crossing — see the `amt` case in `rangeFor`, which has no range to
    // consult, and whose NA sentinel would otherwise read "N/A" for every
    // household. `amtApplies` is the one gate every AMT surface asks, so the
    // report and the year badge cannot disagree about whether AMT applied.
    case "amt":
      return amtApplies(f.amtAdditional) ? "out" : "full";
    // A percentage-of-AGI limit is never "phased out" — it always applies.
    case "charitableLimit":
      return "full";
  }

  const range = rangeFor(item, f.year, f.params, f.household.filingStatus, f.household);
  if (isNaRange(range)) return "na";

  const income = incomeFor(item, f);

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
 * here," never "unseeded" — so it must NOT be inferred from the sentinel.
 * Two non-MFJ cases can reach this function with `coveredSpouse` true, and
 * each is decided explicitly on filing status, before `rangeFor` is called:
 *
 *  - MFS: per Pub 590-A, a non-covered MFS filer whose spouse IS covered
 *    isn't exempt from the phase-out — IRC 219(g)(1) triggers on either
 *    spouse being covered, and 219(g)(3)(B)(iii) then fixes the MFS range at
 *    the same narrow $0-$10,000 band as a covered MFS filer, regardless of
 *    which spouse is the one covered. `rangeFor("iraDeductCovered", …)`
 *    already returns that narrow band for MFS unconditionally (its own
 *    isMfs short-circuit), so MFS is routed there.
 *  - Single/HOH: no spouse exists to be a covered participant, so IRC
 *    219(g)(1) is never triggered by one — full deduction, no gating, and no
 *    call into `rangeFor("iraDeductSpousal", …)` at all.
 *    NOT modeled: a MARRIED taxpayer filing HOH via the "considered
 *    unmarried" six-month-apart test, whose spouse IS covered. IRC
 *    219(g)(4)'s living-apart relief requires the ENTIRE year, which the
 *    six-month HOH test doesn't guarantee, so such a filer arguably should
 *    still phase out. Unresolvable here — it depends on how a later task
 *    derives `coveredSpouse` for an HOH household — so it's flagged, not
 *    implemented.
 *
 * Once both are routed away, every remaining path (covered-MFJ/single/HOH,
 * spousal-MFJ) reads a nullable params column, so an NA reaching the check
 * below always means "not seeded yet."
 */
export function traditionalIraDeductibleAmount(
  magi: number, contribution: number, annualLimit: number,
  coveredSelf: boolean, coveredSpouse: boolean,
  year: number, params: TaxYearParameters, filingStatus: FilingStatus,
): number {
  // IRC 219(b)(1)(A) caps the deduction at the annual limit REGARDLESS of MAGI.
  // It is applied once, here, over whatever the 219(g) phase-out leaves —
  // rather than repeated on each early return below, where one missed path is
  // invisible. Capping only INSIDE the phase-out band (the former shape) put a
  // cliff at the range start: just below it the whole contribution came back,
  // one dollar above it min(contribution, ~limit) did.
  //
  // This includes the unseeded-params path. `annualLimit` is built from
  // `contribLimits.iraTradLimit`, a NOT NULL column seeded independently of
  // the nullable `iraDeduct` columns whose absence produces the NA range, so
  // capping there is not capping by an unseeded number — and §219(b)(1)(A) is
  // not a phase-out, so "params unseeded, don't phase out" never reached it.
  return Math.min(annualLimit, phasedOutIraDeduction(
    magi, contribution, annualLimit, coveredSelf, coveredSpouse, year, params, filingStatus,
  ));
}

/** IRC 219(g)'s phase-out alone — see the §219(b)(1)(A) cap applied by the
 *  exported wrapper above, which every path here flows through. */
function phasedOutIraDeduction(
  magi: number, contribution: number, annualLimit: number,
  coveredSelf: boolean, coveredSpouse: boolean,
  year: number, params: TaxYearParameters, filingStatus: FilingStatus,
): number {
  if (!coveredSelf && !coveredSpouse) return contribution;

  // No spouse exists to be a covered participant, so IRC 219(g)(1) is not
  // triggered by one. Decided here, on filing status alone — not inferred
  // from rangeFor("iraDeductSpousal", ...)'s NA, which fires for this same
  // case but for the unrelated reason that it's an MFJ-only item.
  if (!coveredSelf && !isMfj(filingStatus) && !isMfs(filingStatus)) return contribution;

  const item: ThresholdItemId =
    coveredSelf || isMfs(filingStatus) ? "iraDeductCovered" : "iraDeductSpousal";
  const range = rangeFor(item, year, params, filingStatus);
  if (isNaRange(range) || range.end == null) return contribution;
  if (magi <= range.start) return contribution;
  if (magi >= range.end) return 0;
  const fraction = (magi - range.start) / (range.end - range.start);
  // IRC 219(g)(2)(A) reduces the §219(b) annual LIMIT by the phase-out
  // fraction; §219(a) then deducts the contribution against that reduced
  // limit. Applying the fraction to the CONTRIBUTION instead under-deducts
  // whenever the contribution is below the limit — a $6,000 contribution
  // against a $7,000 limit at fraction 0.8 deducts $1,400, not $1,200.
  // The two agree only when contribution === annualLimit, which is why a
  // suite full of at-the-limit cases pinned nothing here.
  //
  // Same shape as `rothIraAllowedContribution` above, which already reduces
  // its `ageBasedLimit` — the two phase-outs now derive identically and
  // `roundReducedLimit`'s ceiling is the statutory limit in both.
  const reducedLimit = roundReducedLimit(annualLimit * (1 - fraction), annualLimit);
  return Math.min(contribution, reducedLimit);
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

  // An unseeded cap falls back to the statute — the ONE place this module
  // narrows the standing "unseeded -> don't gate, return the full amount" rule,
  // and deliberately so. IRC 221(b)(1)'s $2,500 is FIXED and never
  // inflation-indexed, so a null here cannot mean "awaiting this year's indexed
  // value" the way a null phase-out bound can; it can only mean "not seeded",
  // and the statute already supplies the answer. Treating it as "no cap"
  // instead would deduct a household's ENTIRE student-loan interest — ~$13,000
  // on a $200k balance at 6.5%, against a $2,500 ceiling.
  //
  // The RANGE below keeps the standing rule: those bounds ARE indexed, there is
  // no constant to fall back to, so unseeded still means "don't gate". Net
  // behaviour against an unseeded DB is therefore capped but not phased out.
  const cap = params.studentLoan.maxDeduction ?? STATUTORY_FIXED.studentLoanMaxDeduction;
  const capped = Math.min(interestPaid, cap);

  const range = rangeFor("studentLoanInterest", year, params, filingStatus);
  // MFS (the only genuinely-inapplicable case) was already ruled out above,
  // so any NA reaching here can only mean "not seeded yet" — don't gate.
  if (isNaRange(range) || range.end == null) return capped;
  if (magi <= range.start) return capped;
  if (magi >= range.end) return 0;
  const fraction = (magi - range.start) / (range.end - range.start);
  return capped * (1 - fraction); // linear, no rounding — Pub 590-A's $10 rule is IRA-specific
}
