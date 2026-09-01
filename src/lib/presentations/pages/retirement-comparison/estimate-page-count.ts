// src/lib/presentations/pages/retirement-comparison/estimate-page-count.ts
import type { RetirementComparisonPageData } from "./types";

/** Two Letter sheets: Outcome (verdict + lead chart + stat cards) and the
 *  detail sheet (max-spend + confidence charts + matrix + AI). Long AI text
 *  spills via wrap. With no scenario picked the page prints a one-sheet empty
 *  state, and claiming two there shifts every later Contents entry by one.
 *  `data` is optional because the registry contract allows a data-free probe. */
export function estimateRetirementComparisonPageCount(data?: RetirementComparisonPageData): number {
  return data?.isEmpty ? 1 : 2;
}
