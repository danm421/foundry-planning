// src/lib/tax/state-income/special-rules.ts
// NY / CT bracket recapture. CA is deliberately excluded — see the note below.
// Phase 1 simplifications documented inline.
import type { USPSStateCode } from "@/lib/usps-states";
import type { StateFilingStatus } from "./types";

interface RecaptureInput {
  stateTaxableIncome: number;
  preCreditTax: number;
  filingStatus: StateFilingStatus;
}
interface RecaptureResult {
  adjustment: number;
  note: string;
}

type RecaptureFn = (input: RecaptureInput) => RecaptureResult;

export const RECAPTURE_RULES: Partial<Record<USPSStateCode, RecaptureFn>> = {
  // California is deliberately ABSENT. CA has no bracket recapture: its rate
  // schedule is purely marginal, and the 1% Mental Health Services Tax on income
  // over $1M is already folded into the top tier of the bracket table
  // (brackets-2026.ts: 12.3% up to $1M, 13.3% above). A rule here would
  // double-count it. The previous rule taxed ALL income at 13.3% once income
  // crossed $1M, overstating a $1.5M single return by ~$29K and creating a
  // ~$29K cliff on the first dollar over the threshold.
  // NY supplemental tax (Tax Law §601(d-1)/(d-2)) recaptures the benefit of
  // lower brackets above $107,650 in piecewise fashion. Phase 1 simplification:
  // only model the *full* recapture above $25M (top-rate-on-all-income). Partial
  // recapture between $107,650 and $25M is not modeled — see future-work.
  NY: (input) => {
    const fullRecaptureThreshold = 25_000_000;
    if (input.stateTaxableIncome <= fullRecaptureThreshold) {
      return {
        adjustment: 0,
        note: "NY recapture: below full recapture threshold (partial recapture not modeled in Phase 1).",
      };
    }
    const target = input.stateTaxableIncome * 0.109;
    const adjustment = Math.max(0, target - input.preCreditTax);
    return { adjustment, note: "NY recapture: top rate applied to all income above $25M." };
  },
  // CT phases out the benefit of the 3% bracket between $200K and $340K (MFJ)
  // or $100,500 and $200K (single). Within the phase-out, the up-to-$600 (MFJ)
  // or $300 (single) benefit is recaptured linearly.
  CT: (input) => {
    const phaseoutStart = input.filingStatus === "joint" ? 200_000 : 100_500;
    if (input.stateTaxableIncome <= phaseoutStart) {
      return { adjustment: 0, note: "CT phase-out: below threshold." };
    }
    const phaseoutEnd = input.filingStatus === "joint" ? 340_000 : 200_000;
    const benefit = input.filingStatus === "joint" ? 600 : 300;
    const progress = Math.min(
      1,
      (input.stateTaxableIncome - phaseoutStart) / (phaseoutEnd - phaseoutStart),
    );
    const adjustment = benefit * progress;
    return {
      adjustment,
      note: `CT 3% rate phase-out: $${adjustment.toFixed(0)} recaptured.`,
    };
  },
};

export function applyRecapture(
  state: USPSStateCode,
  input: RecaptureInput,
): RecaptureResult {
  const fn = RECAPTURE_RULES[state];
  if (!fn) return { adjustment: 0, note: "" };
  return fn(input);
}
