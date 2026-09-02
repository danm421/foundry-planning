import type { ScenarioComparisonPageData } from "./types";

/** Two Letter sheets: the comparison matrix, then the tradeoff bands. With no
 *  scenario chosen the page prints a one-sheet empty state, and claiming two
 *  there shifts every later Contents entry by one. Narratives and change lists
 *  are both capped upstream, so the second sheet cannot grow to a third.
 *  `data` is optional because the registry contract allows a data-free probe. */
export function estimateScenarioComparisonPageCount(
  data?: ScenarioComparisonPageData,
): number {
  return data?.isEmpty ? 1 : 2;
}
