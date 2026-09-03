import type { ScenarioComparisonPageData } from "./types";

/** Two Letter sheets: the comparison matrix, then the tradeoff bands. With no
 *  scenario chosen the page prints a one-sheet empty state, and claiming two
 *  there shifts every later Contents entry by one. Narratives and change lists
 *  are both capped upstream, so the second sheet cannot grow to a third.
 *
 *  The second sheet also drops out when `showTradeoffBands` is off — `data.bands`
 *  is `[]` in that case and the composer omits the sheet rather than print a
 *  section head over blank space (`page-pdf.tsx`). This estimate has to move
 *  with that same condition: the deck's Contents is numbered from estimates,
 *  and a renderer/estimate mismatch shifts every later entry. */
export function estimateScenarioComparisonPageCount(
  data: ScenarioComparisonPageData,
): number {
  if (data.isEmpty) return 1;
  return data.bands.length > 0 ? 2 : 1;
}
