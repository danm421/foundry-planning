import type { Finding, FindingContext } from "../types";
import { fmtUsd, fmtPct } from "../format";
import { n } from "../adapter";
import { isNoIncomeTaxState } from "@/lib/tax/state-income/data/no-income-tax-states";
import type { USPSStateCode } from "@/lib/usps-states";

// Statutory §24(h) phase-out thresholds (not inflation-indexed, so constants
// here rather than TaxYearParameters).
const CTC_THRESHOLD_MFJ = 400000;
const CTC_THRESHOLD_OTHER = 200000;
const CTC_NEAR = 50000;

// §25A(d) AOTC/LLC MAGI windows (statutory, unindexed for AOTC).
const EDU_WINDOW = { mfj: [160000, 180000], other: [80000, 90000] } as const;

export function ctcPhaseout(ctx: FindingContext): Finding | null {
  const f = ctx.facts;
  const kids = n(f.dependentsUnder17);
  if (kids <= 0 || f.income.agi == null || !f.filingStatus) return null;
  const threshold = f.filingStatus === "married_joint" ? CTC_THRESHOLD_MFJ : CTC_THRESHOLD_OTHER;
  const agi = f.income.agi;
  if (agi > threshold) {
    const excess = agi - threshold;
    const reduction = Math.ceil(excess / 1000) * 50;
    return {
      id: "ctc-phaseout",
      severity: "watch",
      category: "credits",
      headline: "Child tax credit is phasing out",
      whatTheReturnShows: `AGI of ${fmtUsd(agi)} exceeds the ${fmtUsd(threshold)} child-tax-credit threshold by ${fmtUsd(excess)}, reducing the credit by about ${fmtUsd(reduction)} ($50 per $1,000 over). AGI-reducing moves (401k/HSA deferrals, harvesting losses) claw some of this back.`,
      whyItMatters: "",
      whatToConsider: "",
      lineRefs: [],
      estimatedImpact: null,
      numbers: { excess, reduction },
    };
  }
  if (threshold - agi < CTC_NEAR) {
    return {
      id: "ctc-phaseout",
      severity: "watch",
      category: "credits",
      headline: "Approaching the child-tax-credit phase-out",
      whatTheReturnShows: `AGI of ${fmtUsd(agi)} is within ${fmtUsd(threshold - agi)} of the ${fmtUsd(threshold)} phase-out threshold — income spikes (bonuses, gains, conversions) would start eroding the credit.`,
      whyItMatters: "",
      whatToConsider: "",
      lineRefs: [],
      estimatedImpact: null,
      numbers: { headroom: threshold - agi },
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
  const where = agi >= hi ? "above" : "inside";
  return {
    id: "education-credits",
    severity: "watch",
    category: "credits",
    headline: "Education credit MAGI limits",
    whatTheReturnShows: `MAGI of ${fmtUsd(agi)} is ${where} the ${fmtUsd(lo)}–${fmtUsd(hi)} phase-out window for education credits (AOTC/Lifetime Learning). ${where === "above" ? "The credits are unavailable at this income — consider whether the student should claim them on their own return, or fund via 529 instead." : "Part of the credit is being lost to the phase-out."}`,
    whyItMatters: "",
    whatToConsider: "",
    lineRefs: [],
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
      whatTheReturnShows: `${state} has no state income tax, so federal-only strategies (Roth timing, gain harvesting) carry no state-side cost here.`,
      whyItMatters: "",
      whatToConsider: "",
      lineRefs: [],
      estimatedImpact: null,
      numbers: {},
    };
  }
  const s = ctx.calc?.state;
  if (!s || !s.hasIncomeTax) return null;
  const topRate = s.bracketsUsed.length > 0 ? s.bracketsUsed[s.bracketsUsed.length - 1].rate : 0;
  const rules = s.specialRulesApplied.length > 0 ? ` Notes: ${s.specialRulesApplied.join("; ")}.` : "";
  return {
    id: "state-notes",
    severity: "info",
    category: "state",
    headline: `${state} state income tax`,
    whatTheReturnShows: `We estimate roughly ${fmtUsd(s.stateTax)} of ${state} income tax on this return's income (top applicable rate ${fmtPct(topRate)}).${rules}`,
    whyItMatters: "",
    whatToConsider: "",
    lineRefs: [],
    estimatedImpact: null,
    numbers: { stateTax: s.stateTax, topRate },
  };
}
