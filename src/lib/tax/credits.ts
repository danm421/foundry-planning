/**
 * Federal credit layer — CTC/ACTC, ODC, AOTC, Saver's Credit.
 *
 * Pure, self-contained, framework-free (no Next/DB imports). Nothing wires
 * this in yet: `calculate.ts` (Task 9) and `projection.ts` (Task 11) are
 * future tasks. The 4-year AOTC-per-student cap is also the caller's job —
 * this module receives only the students eligible THIS year.
 */

import type { FilingStatus, TaxYearParameters, SaversCreditTier } from "./types";
import { STATUTORY_FIXED } from "./constants";
import { rangeFor, isNaRange } from "./thresholds";

export interface CreditsInput {
  year: number;
  filingStatus: FilingStatus;
  params: TaxYearParameters;
  magi: number;
  agi: number;
  earnedIncome: number;
  /** Regular bracket tax + cap-gains tax + AMT additional. */
  taxBeforeCredits: number;
  qualifyingChildren: number;
  otherDependents: number;
  /** One entry per student eligible THIS year; the 4-year cap is applied by the caller. */
  aotcStudents: { qualifiedExpenses: number }[];
  retirementContributions: { client: number; spouse: number };
}

export interface CreditsResult {
  nonrefundable: number;
  refundable: number;
  byCredit: {
    saversCredit: number;
    aotcNonrefundable: number;
    aotcRefundable: number;
    odc: number;
    ctcNonrefundable: number;
    ctcRefundable: number;
  };
}

// ── Saver's Credit (IRC 25B) ─────────────────────────────────────────────────

/** Mirrors `rangeFor`'s own ("saversCredit") routing exactly: MFJ and HOH get
 *  their own tables; everyone else — including MFS, which IRC 25B does not
 *  deny — uses the single table. */
function saversCreditTiers(filingStatus: FilingStatus, params: TaxYearParameters): SaversCreditTier[] {
  if (filingStatus === "married_joint") return params.saversCredit.mfj;
  if (filingStatus === "head_of_household") return params.saversCredit.hoh;
  return params.saversCredit.single;
}

/**
 * `year` (the REQUESTED year, per R8) drives only the SECURE 2.0 §103 sunset.
 * Never read `params.year` for this: `resolver.ts` sets `params.year` to the
 * SOURCE year when inflating an out-year forward, so a caller wiring
 * `facts.year = params.year` would report this credit live forever past 2026.
 * (Same why-comment as `thresholds.ts`'s own year-vs-params.year note.)
 */
function computeSaversCredit(input: CreditsInput): number {
  if (input.year > STATUTORY_FIXED.saversCreditLastYear) return 0;

  const tiers = saversCreditTiers(input.filingStatus, input.params);
  // Tiers are ordered highest-rate-first; the first tier whose ceiling covers
  // this AGI is the one that applies. AGI above every ceiling, or an empty
  // (unseeded) table, both fall through to rate 0.
  const tier = tiers.find((t) => t.agiCeiling >= input.agi);
  const rate = tier?.rate ?? 0;
  if (rate === 0) return 0;

  const cap = STATUTORY_FIXED.saversMaxContributionPerPerson;
  // IRC 25B(a): the $2,000 contribution ceiling is PER PERSON; the AGI tier
  // table is PER RETURN — look the rate up once, apply the cap twice.
  //
  // Both entries are summed as given. Whether the spouse figure actually
  // belongs on THIS return (e.g. a single/HOH filer with no spouse on the
  // return at all) is the CALLER's decision (Task 11), not filtered here —
  // mirroring how Tasks 4 and 6 left comparable caller-owned edges unresolved
  // in this layer.
  const { client, spouse } = input.retirementContributions;
  return rate * (Math.min(client, cap) + Math.min(spouse, cap));
}

// ── American Opportunity Tax Credit (IRC 25A) ───────────────────────────────

interface AotcSplit {
  nonrefundable: number;
  refundable: number;
}

function computeAotc(input: CreditsInput): AotcSplit {
  // IRC 25A(g)(6): denied outright to MFS filers. Decided on filing status
  // BEFORE consulting rangeFor — rangeFor's own NA_RANGE for ("aotc", MFS)
  // means exactly this, but inferring statutory denial from the NA sentinel
  // is the trap R3 calls out: the same sentinel elsewhere means "not seeded
  // yet," and this module must never conflate the two.
  if (input.filingStatus === "married_separate") return { nonrefundable: 0, refundable: 0 };

  const range = rangeFor("aotc", input.year, input.params, input.filingStatus);
  // Every non-MFS filing status yields a real STATUTORY_FIXED-backed range —
  // AOTC amounts are never null, so this is unreachable in practice. Kept so
  // a future change to rangeFor fails safe (0 credit) rather than throwing.
  if (isNaRange(range) || range.end == null) return { nonrefundable: 0, refundable: 0 };

  const S = STATUTORY_FIXED;
  // Same surviving-fraction shape as `studentLoanInterestDeduction`: linear
  // phase-out (IRC 25A(d)), one household MAGI applied identically to every
  // student. No Pub 590-A $10 round-up — that rounding is IRA/Roth-specific.
  const rawFraction = (range.end - input.magi) / (range.end - range.start);
  const survivingFraction = Math.max(0, Math.min(1, rawFraction));

  let nonrefundable = 0;
  let refundable = 0;
  for (const student of input.aotcStudents) {
    const raw =
      Math.min(S.aotcFullCreditExpenses, student.qualifiedExpenses) +
      S.aotcPartialRate * Math.min(S.aotcPartialCreditExpenses, Math.max(0, student.qualifiedExpenses - S.aotcFullCreditExpenses));
    const capped = Math.min(S.aotcMaxPerStudent, raw);
    const phased = capped * survivingFraction;
    // The $1,000 refundable cap can never bind after the $2,500 total cap
    // (40% of 2,500 is exactly 1,000) — implemented anyway per the brief.
    const studentRefundable = Math.min(S.aotcRefundableRate * phased, S.aotcRefundableCap);
    refundable += studentRefundable;
    nonrefundable += phased - studentRefundable;
  }

  return { nonrefundable, refundable };
}

// ── Child Tax Credit / Credit for Other Dependents (IRC 24) ─────────────────

interface CtcOdcPhaseout {
  ctcAfter: number;
  odcAfter: number;
  afterPhaseout: number;
}

/**
 * IRC 24(h)(4) applies the SAME 24(b) phase-down to CTC and ODC on their
 * COMBINED gross amount. Splitting the after-phaseout figure back into a CTC
 * part and an ODC part is needed only because `byCredit` reports them
 * separately — IRC 24 itself never attributes the reduction between the two.
 *
 * Allocating the reduction to the ODC portion FIRST (R5) is not an arbitrary
 * tie-break. The TOTAL amount later usable against tax is
 * `min(afterPhaseout, remainingTaxAtThatPoint)` regardless of how the
 * reduction (or the subsequent tax-offset) is split between ODC and CTC —
 * consuming ODC-then-CTC in sequence, each capped at its own remaining
 * amount, always sums to the same total as one combined cap would. That
 * means Schedule 8812 line 16a's aggregate "combined credit minus combined
 * amount used" and this module's own ODC-first bookkeeping are provably
 * identical for every input — see `computeCredits` below, where `unused` is
 * computed the aggregate way.
 */
function computeCtcOdcPhaseout(input: CreditsInput): CtcOdcPhaseout {
  const S = STATUTORY_FIXED;
  // R2: perChild and odcPerDependent are gated INDEPENDENTLY — do not copy
  // rangeFor's `perChild == null || odc == null -> NA` conjunction. A null
  // column IS the credit amount here (0), never a reason to zero the other.
  const perChild = input.params.ctc.perChild ?? 0;
  const odcPerDependent = input.params.ctc.odcPerDependent ?? 0;

  const ctcGross = input.qualifyingChildren * perChild;
  const odcGross = input.otherDependents * odcPerDependent;
  const gross = ctcGross + odcGross;

  const threshold = input.filingStatus === "married_joint"
    ? S.ctcPhaseoutThresholdMfj
    : S.ctcPhaseoutThresholdOther; // MFS/single/HOH all share the $200k "other" threshold — IRC 24 has no MFS denial.
  const excess = Math.max(0, input.magi - threshold);
  // "or fraction thereof" -> ceil, not floor. $1 over the threshold costs the full $50 step.
  const reduction = Math.ceil(excess / S.ctcReductionStep) * S.ctcReductionPerStep;

  const odcAfter = Math.max(0, odcGross - reduction);
  const ctcAfter = Math.max(0, ctcGross - Math.max(0, reduction - odcGross));

  return { ctcAfter, odcAfter, afterPhaseout: Math.max(0, gross - reduction) };
}

// ── Assembly ─────────────────────────────────────────────────────────────

export function computeCredits(input: CreditsInput): CreditsResult {
  const saversCreditFull = computeSaversCredit(input);
  const aotc = computeAotc(input);
  const { ctcAfter, odcAfter, afterPhaseout } = computeCtcOdcPhaseout(input);

  // Nonrefundable ordering (R4): Saver's -> AOTC(60% part) -> ODC -> CTC. CTC
  // goes LAST precisely so its unused portion can flow to the refundable
  // ACTC below — applying it earlier would consume tax liability the other
  // credits should have absorbed first, understating the refund.
  let remainingTax = Math.max(0, input.taxBeforeCredits);

  const saversUsed = Math.min(saversCreditFull, remainingTax);
  remainingTax -= saversUsed;

  const aotcNonrefundableUsed = Math.min(aotc.nonrefundable, remainingTax);
  remainingTax -= aotcNonrefundableUsed;

  const odcUsed = Math.min(odcAfter, remainingTax);
  remainingTax -= odcUsed;

  const ctcNonrefundableUsed = Math.min(ctcAfter, remainingTax);
  remainingTax -= ctcNonrefundableUsed;

  // Schedule 8812 line 16a/16b (R6): the combined after-phaseout CTC+ODC
  // amount minus whatever combined amount actually offset tax, capped at
  // (qualifying children x refundableMax) and at the earned-income formula.
  // ODC is never refundable — its own leftover, if any, is simply lost, which
  // is why this is the AGGREGATE leftover and not just the CTC's own slice
  // (see computeCtcOdcPhaseout's docblock for why the two are equal anyway).
  const refundableMax = input.params.ctc.refundableMax ?? 0;
  const unused = afterPhaseout - (odcUsed + ctcNonrefundableUsed);
  const actc = Math.min(
    unused,
    input.qualifyingChildren * refundableMax,
    STATUTORY_FIXED.actcEarnedIncomeRate * Math.max(0, input.earnedIncome - STATUTORY_FIXED.actcEarnedIncomeFloor)
  );

  return {
    nonrefundable: saversUsed + aotcNonrefundableUsed + odcUsed + ctcNonrefundableUsed,
    refundable: aotc.refundable + actc,
    byCredit: {
      saversCredit: saversUsed,
      aotcNonrefundable: aotcNonrefundableUsed,
      aotcRefundable: aotc.refundable,
      odc: odcUsed,
      ctcNonrefundable: ctcNonrefundableUsed,
      ctcRefundable: actc,
    },
  };
}
