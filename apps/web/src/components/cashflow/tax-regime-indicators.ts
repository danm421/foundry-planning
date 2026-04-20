import type { ProjectionYear } from "@foundry/engine";

export type TransitionType =
  | "amt_first_year"
  | "niit_first_year"
  | "addl_medicare_first_year"
  | "retirement_fica_zero"
  | "marginal_rate_jump";

/**
 * Scan a projection and flag the year a regime transition first occurs.
 * First year of the projection never produces a transition (no prior to compare).
 * Returns a map keyed by year; years without transitions are absent from the map.
 */
export function detectRegimeTransitions(
  years: ProjectionYear[]
): Record<number, TransitionType[]> {
  const out: Record<number, TransitionType[]> = {};

  for (let i = 1; i < years.length; i++) {
    const curr = years[i];
    const prev = years[i - 1];
    if (!curr.taxResult || !prev.taxResult) continue;

    const transitions: TransitionType[] = [];
    const c = curr.taxResult.flow;
    const p = prev.taxResult.flow;

    if (c.amtAdditional > 0 && p.amtAdditional === 0) {
      transitions.push("amt_first_year");
    }
    if (c.niit > 0 && p.niit === 0) {
      transitions.push("niit_first_year");
    }
    if (c.additionalMedicare > 0 && p.additionalMedicare === 0) {
      transitions.push("addl_medicare_first_year");
    }
    if (c.fica === 0 && p.fica > 0) {
      transitions.push("retirement_fica_zero");
    }

    const currMarginal = curr.taxResult.diag.marginalFederalRate;
    const prevMarginal = prev.taxResult.diag.marginalFederalRate;
    if (currMarginal - prevMarginal >= 0.05) {
      transitions.push("marginal_rate_jump");
    }

    if (transitions.length > 0) {
      out[curr.year] = transitions;
    }
  }

  return out;
}

/**
 * Tooltip copy for each transition type. Used by table components to display
 * a hover explanation on the indicator.
 */
export const TRANSITION_TOOLTIPS: Record<TransitionType, string> = {
  amt_first_year:
    "First year AMT applies. Usually driven by high AGI phasing out your AMT exemption.",
  niit_first_year:
    "First year NIIT applies. MAGI now exceeds the $250k MFJ / $200k single threshold.",
  addl_medicare_first_year:
    "First year additional Medicare applies. Earned income now exceeds the threshold.",
  retirement_fica_zero:
    "First year with no FICA. Earned income has stopped.",
  marginal_rate_jump:
    "Marginal rate jumped at least 5 percentage points — you crossed into a higher bracket this year.",
};

/**
 * Color class for the year-cell left border given a transition type.
 * Green for retirement (positive planning event), amber for tax surcharges
 * kicking in, blue for bracket transitions.
 */
export const TRANSITION_BORDER_CLASS: Record<TransitionType, string> = {
  amt_first_year: "border-l-4 border-amber-500",
  niit_first_year: "border-l-4 border-amber-500",
  addl_medicare_first_year: "border-l-4 border-amber-500",
  retirement_fica_zero: "border-l-4 border-green-500",
  marginal_rate_jump: "border-l-4 border-blue-500",
};

/**
 * When multiple transitions land on the same year, priority ordering for
 * picking the single border color. Amber (surcharge) wins over green/blue
 * since it's usually the more actionable signal for an advisor.
 */
export function pickBorderTransition(transitions: TransitionType[]): TransitionType {
  const priority: TransitionType[] = [
    "amt_first_year",
    "niit_first_year",
    "addl_medicare_first_year",
    "marginal_rate_jump",
    "retirement_fica_zero",
  ];
  for (const t of priority) {
    if (transitions.includes(t)) return t;
  }
  return transitions[0];
}
