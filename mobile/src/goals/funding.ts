// mobile/src/goals/funding.ts
//
// Presentation rules for the Goals funded tile. Pure — no react imports.
//
// Mirrors the web tile (src/components/portal/dashboard-tiles/
// tile-goals-funded.tsx) exactly: both surfaces read the same projection, so a
// goal that reads green on the web must not read amber on the phone.
import type { PortalGoalFunding } from "@contracts";
import { formatMoney } from "@/ui/money";

export type GoalTone = "good" | "warn" | "crit";

/**
 * Fully funded reads good; a real gap reads critical; short of fully funded
 * but close reads as a warning rather than a failure.
 *
 * The 0.995 boundary is the rounding boundary the percentage label uses — at
 * 99.5% the tile prints "100%", so it has to read green too, or the number and
 * the bar disagree with each other.
 */
export function goalTone(pctFunded: number): GoalTone {
  if (pctFunded >= 0.995) return "good";
  if (pctFunded >= 0.9) return "warn";
  return "crit";
}

/** "2040–2065", "2040", or null when the goal costs nothing and has no years. */
export function goalYearRange(goal: PortalGoalFunding): string | null {
  if (goal.startYear == null) return null;
  if (goal.endYear == null || goal.endYear === goal.startYear) return `${goal.startYear}`;
  return `${goal.startYear}–${goal.endYear}`;
}

/** "$40,000 short of $100,000", or "$100,000 funded" once the goal is covered. */
export function goalGapLabel(goal: PortalGoalFunding): string {
  // Clamped: an overfunded goal is covered, not negatively short.
  const gap = Math.max(0, goal.cost - goal.funded);
  return gap > 0
    ? `${formatMoney(gap)} short of ${formatMoney(goal.cost)}`
    : `${formatMoney(goal.cost)} funded`;
}
