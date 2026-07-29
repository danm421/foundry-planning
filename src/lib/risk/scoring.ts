//
// Pure composite math for the household risk profile. No DB, no Next imports.
//
// The model is deliberately NOT a weighted average. Capacity is a hard ceiling:
// a household with tolerance 90 and capacity 25 lands at 25, not at the ~57 an
// average would produce. Averaging hides the binding constraint, which is the
// exact failure mode that produces unsuitable allocations. Environment adjusts
// tolerance only and can never breach the ceiling -- if off-plan assets are
// real, they belong in the plan.
import type { RiskLevel } from "@/lib/risk-levels";

export const ENV_ADJ_MIN = -25;
export const ENV_ADJ_MAX = 25;

export type BindingConstraint = "tolerance" | "capacity" | "none";

export interface ProfileInputs {
  /** 0-100. Null when no RTQ has been taken and no rung was set by hand. */
  toleranceScore: number | null;
  /** 0-100. Null when the household has no plan to derive capacity from. */
  capacityScore: number | null;
  /** -25..25. Zero when the advisor has recorded no circumstances. */
  environmentAdj: number;
}

export interface ProfileResult {
  compositeScore: number | null;
  compositeLevel: RiskLevel | null;
  bindingConstraint: BindingConstraint;
  /** True when capacity is unknown, so no ceiling has been applied. */
  provisional: boolean;
}

/** Score a hand-picked rung maps to, and the value `band` returns it from. */
export const BAND_CENTERS: Record<RiskLevel, number> = {
  conservative: 10,
  moderately_conservative: 30,
  moderate: 50,
  moderately_aggressive: 70,
  aggressive: 90,
};

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** Flat 20-point bands. Every BAND_CENTERS value round-trips through this. */
export function band(score: number): RiskLevel {
  if (score < 20) return "conservative";
  if (score < 40) return "moderately_conservative";
  if (score < 60) return "moderate";
  if (score < 80) return "moderately_aggressive";
  return "aggressive";
}

export function computeProfile(i: ProfileInputs): ProfileResult {
  // No tolerance means no profile. Capacity alone is an ability to bear risk,
  // not a decision to take it -- surfacing these households is the main reason
  // the Risk list exists.
  if (i.toleranceScore === null) {
    return {
      compositeScore: null,
      compositeLevel: null,
      bindingConstraint: "none",
      provisional: i.capacityScore === null,
    };
  }

  const adjusted = clamp(i.toleranceScore + i.environmentAdj, 0, 100);

  if (i.capacityScore === null) {
    return {
      compositeScore: adjusted,
      compositeLevel: band(adjusted),
      bindingConstraint: "none",
      provisional: true,
    };
  }

  const composite = Math.min(adjusted, i.capacityScore);
  return {
    compositeScore: composite,
    compositeLevel: band(composite),
    bindingConstraint: i.capacityScore < adjusted ? "capacity" : "tolerance",
    provisional: false,
  };
}
