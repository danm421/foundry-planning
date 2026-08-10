import type { Finding, FindingContext } from "../types";
import { fmtUsd, fmtPct } from "../format";
import { n } from "../adapter";
import { isNoIncomeTaxState } from "@/lib/tax/state-income/data/no-income-tax-states";
import { STATUTORY_FIXED } from "@/lib/tax/constants";
import type { USPSStateCode } from "@/lib/usps-states";

// The §24(h) and §25A(d) figures below are unindexed, so they live in
// STATUTORY_FIXED rather than TaxYearParameters. Read from there rather than
// re-declared here — a second copy of a statutory threshold is a second thing
// to update when Congress moves one.
const CTC_THRESHOLD_MFJ = STATUTORY_FIXED.ctcPhaseoutThresholdMfj;
const CTC_THRESHOLD_OTHER = STATUTORY_FIXED.ctcPhaseoutThresholdOther;
const CTC_NEAR = 50000;

const EDU_WINDOW = {
  mfj: [STATUTORY_FIXED.aotcPhaseoutStartMfj, STATUTORY_FIXED.aotcPhaseoutEndMfj],
  other: [STATUTORY_FIXED.aotcPhaseoutStartOther, STATUTORY_FIXED.aotcPhaseoutEndOther],
} as const;

export function ctcPhaseout(ctx: FindingContext): Finding | null {
  const f = ctx.facts;
  const kids = n(f.dependentsUnder17);
  if (kids <= 0 || f.income.agi == null || !f.filingStatus) return null;
  const threshold = f.filingStatus === "married_joint" ? CTC_THRESHOLD_MFJ : CTC_THRESHOLD_OTHER;
  const agi = f.income.agi;

  if (agi > threshold) {
    const excess = agi - threshold;
    // $50 per $1,000 is a RATE, not the amount at stake: the phase-out cannot
    // remove more credit than exists. Uncapped, a one-child MFJ return at 500k
    // AGI published a $5,000 loss against a credit worth a fraction of that.
    // perChild is null only when the year's parameters are unseeded — no
    // ceiling is knowable then, so the figure degrades to the raw estimate.
    const perChild = ctx.params.ctc.perChild;
    const ceiling = perChild != null ? kids * perChild : null;
    const rawReduction =
      Math.ceil(excess / STATUTORY_FIXED.ctcReductionStep) * STATUTORY_FIXED.ctcReductionPerStep;
    const reduction = ceiling != null ? Math.min(rawReduction, ceiling) : rawReduction;
    const fullyPhasedOut = ceiling != null && rawReduction >= ceiling;
    return {
      id: "ctc-phaseout",
      severity: "watch",
      category: "credits",
      headline: `Child tax credit reduced by about ${fmtUsd(reduction)} to income`,
      whatTheReturnShows: `AGI of ${fmtUsd(agi)} (line 11) exceeds the ${fmtUsd(threshold)} child-tax-credit threshold by ${fmtUsd(excess)}, with ${kids} qualifying ${kids === 1 ? "child" : "children"} on the return. The credit phases out at $50 per $1,000 over${fullyPhasedOut ? `, which at this income removes the entire ${fmtUsd(ceiling)} credit` : `, cutting roughly ${fmtUsd(reduction)}`}.`,
      whyItMatters: `Unlike a deduction, a credit comes off the tax itself, so a dollar of credit lost costs a full dollar. The phase-out is driven by AGI, not taxable income, which means deductions taken below the AGI line — the standard deduction, itemized deductions, the QBI deduction — do nothing to restore it.`,
      whatToConsider: `Only above-the-line moves reach this: a larger 401(k) or 403(b) deferral, an HSA contribution, a self-employed retirement plan, or harvesting capital losses against realized gains. Each dollar of AGI removed restores five cents of credit, which is on top of whatever the dollar saves at the marginal rate.`,
      lineRefs: [
        { form: "Form 1040", line: "line 11", label: "Adjusted gross income", amount: agi },
        { form: "Form 1040", line: "line 19", label: "Child tax credit", amount: f.tax.childTaxCredit },
      ],
      estimatedImpact: reduction,
      numbers: { excess, reduction },
    };
  }

  if (threshold - agi < CTC_NEAR) {
    const headroom = threshold - agi;
    return {
      id: "ctc-phaseout",
      severity: "watch",
      category: "credits",
      headline: `${fmtUsd(headroom)} of AGI room before the child tax credit starts phasing out`,
      whatTheReturnShows: `AGI of ${fmtUsd(agi)} (line 11) sits ${fmtUsd(headroom)} below the ${fmtUsd(threshold)} phase-out threshold, with ${kids} qualifying ${kids === 1 ? "child" : "children"} claimed.`,
      whyItMatters: `The credit is intact this year, and nothing has been lost. But the phase-out begins the moment AGI crosses the line, at $50 per $1,000 — so an income spike from a bonus, an exercised option, a realized gain, or a Roth conversion carries a hidden surcharge on top of its own tax.`,
      whatToConsider: `Where a voluntary income event is being planned — a conversion above all — size it against the ${fmtUsd(headroom)} of room, and remember the threshold is not indexed to inflation, so ordinary raises erode it year on year.`,
      lineRefs: [
        { form: "Form 1040", line: "line 11", label: "Adjusted gross income", amount: agi },
        { form: "Form 1040", line: "line 19", label: "Child tax credit", amount: f.tax.childTaxCredit },
      ],
      estimatedImpact: null, // nothing lost yet
      numbers: { headroom },
    };
  }
  return null;
}

export function educationCredits(ctx: FindingContext): Finding | null {
  const f = ctx.facts;
  const relevant = n(f.dependents17to23) > 0 || n(f.tax.educationCredits) > 0;
  if (!relevant || f.income.agi == null || !f.filingStatus) return null;
  const [lo, hi] = f.filingStatus === "married_joint" ? EDU_WINDOW.mfj : EDU_WINDOW.other;
  const agi = f.income.agi;
  if (agi <= lo) return null; // fully eligible — nothing to flag
  const above = agi >= hi;

  return {
    id: "education-credits",
    severity: "watch",
    category: "credits",
    headline: above
      ? "Education credits are unavailable at this income"
      : "Education credits are partly phased out at this income",
    whatTheReturnShows: `MAGI of ${fmtUsd(agi)} (line 11) is ${above ? "above" : "inside"} the ${fmtUsd(lo)}–${fmtUsd(hi)} phase-out window for the American Opportunity and Lifetime Learning credits. The return claims ${fmtUsd(n(f.tax.educationCredits))} of education credits.`,
    whyItMatters: above
      ? `Above ${fmtUsd(hi)} neither credit is available on this return at all — the American Opportunity Credit is worth up to $2,500 per student and the Lifetime Learning Credit up to $2,000 per return, so this is a real amount, not a rounding. A student who is no longer claimed as a dependent and who has their own tax liability can claim the AOTC on their own return, where the parents' income is irrelevant.`
      : `Inside the window the credit is reduced proportionally to how far into it MAGI sits, so part of the available credit is being lost. The reduction is driven by MAGI, which means only above-the-line moves affect it.`,
    whatToConsider: above
      ? `Check whether the student should file independently and claim the credit themselves — this forfeits the parents' dependency exemption benefits, so it is a comparison, not an automatic win. Otherwise 529 withdrawals remain tax-free for qualified expenses regardless of income, making them the vehicle that survives this phase-out.`
      : `Above-the-line deferrals — 401(k), HSA, a self-employed plan — pull MAGI back down the window and restore part of the credit. Coordinating which parent claims the student, and in which year the tuition is actually paid, also moves the timing.`,
    lineRefs: [
      { form: "Form 1040", line: "line 11", label: "Adjusted gross income", amount: agi },
      { form: "Schedule 3", line: "line 3", label: "Education credits", amount: f.tax.educationCredits },
    ],
    // The fraction of the credit actually lost depends on qualified expenses,
    // which the 1040 does not carry. A figure here would be invented.
    estimatedImpact: null,
    numbers: { agi, windowLow: lo, windowHigh: hi },
  };
}

export function stateNotes(ctx: FindingContext): Finding | null {
  const state = ctx.facts.residenceState as USPSStateCode | null;
  if (!state) return null;

  if (isNoIncomeTaxState(state)) {
    return {
      id: "state-notes",
      severity: "info",
      category: "state",
      headline: `${state} levies no state income tax`,
      whatTheReturnShows: `The return reports a ${state} residence, and ${state} imposes no personal income tax on wages, retirement income, or investment income.`,
      whyItMatters: `Every federal-only strategy in this report — Roth conversion timing, gain harvesting, income shifting between years — carries no state-side cost here. In a taxed state, a conversion sized to fill a federal bracket typically triggers state tax on the whole amount at the same time; here it does not.`,
      whatToConsider: `The one thing to watch is residency itself: a move mid-year, or a part-year presence in a taxed state, can pull income back into that state's return. Where a large voluntary event is planned, its timing relative to an actual or contemplated move is worth confirming before it is executed.`,
      lineRefs: [],
      estimatedImpact: null,
      numbers: {},
    };
  }

  const s = ctx.calc?.state;
  if (!s || !s.hasIncomeTax) return null;
  const topRate = s.bracketsUsed.length > 0 ? s.bracketsUsed[s.bracketsUsed.length - 1].rate : 0;
  const rules = s.specialRulesApplied.length > 0 ? ` ${state} rules applied: ${s.specialRulesApplied.join("; ")}.` : "";
  return {
    id: "state-notes",
    severity: "info",
    category: "state",
    headline: `About ${fmtUsd(s.stateTax)} of ${state} income tax on this return's income`,
    whatTheReturnShows: `Applying ${state}'s rules to this return's income produces an estimated ${fmtUsd(s.stateTax)} of state income tax, with a top applicable rate of ${fmtPct(topRate)}.${rules} This is our computation, not a figure transcribed from a filed state return.`,
    whyItMatters: `Every federal strategy in this report has a ${state} cost attached. A Roth conversion sized to fill a federal bracket is also ${fmtPct(topRate)} or so of state tax on the same dollars, and a harvested gain sitting in the 0% federal bracket is generally still fully taxable at the state level — so the true cost of a move is the combined rate, not the federal one.`,
    whatToConsider: `Size voluntary income against the combined federal-plus-state rate. Where ${state} treats retirement income, Social Security, or municipal interest differently from the federal return, that difference is usually the largest single planning lever available at the state level and is worth confirming against the filed state return.`,
    lineRefs: [
      { form: "Form 1040", line: "line 15", label: "Taxable income", amount: ctx.facts.deductions.taxableIncome },
    ],
    estimatedImpact: null, // an existing liability, not something this finding puts in play
    numbers: { stateTax: s.stateTax, topRate },
  };
}
