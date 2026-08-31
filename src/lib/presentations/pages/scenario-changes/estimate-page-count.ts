import type { ScenarioChangesPageData } from "./types";

// Measured against real renders (see estimate-page-count.test.ts, which pins
// every constant here by rendering the page and counting the sheets react-pdf
// actually laid out). A wrong count here does not distort THIS page — the
// footer prints the true page number — it shifts every Contents entry after it,
// which is how "Tax Summary … 8" ended up pointing at page 9.
//
// A change row is `wrap={false}`, so it moves whole: capacity is a simple
// division, not a fill.
// Re-measured after the section head shrank from ~46pt to ~37pt (one template
// across the deck). Rendering 1..70 rows at 1, 2 and 3 detail lines puts the
// first sheet's true capacity in [553.5, 572.25)pt; 562 sits mid-bracket.
// ⚠️ This constant is COUPLED to SectionHead's height — change that and
// re-measure, do not adjust by arithmetic.
const FIRST_SHEET_PT = 562; // under the title block
const LATER_SHEET_PT = 650; // under the repeating column header
const ROW_MIN_PT = 30.3; // the area/what/change stack, whatever the details say
const DETAIL_LINE_PT = 10.125;
const ROW_PADDING_PT = 10.5;
const GROUP_BAND_PT = 21;

function rowHeight(detailLines: number): number {
  return Math.max(ROW_MIN_PT, ROW_PADDING_PT + detailLines * DETAIL_LINE_PT);
}

/** How many sheets the Plan Comparison table will occupy. `data` is optional
 *  because the registry's contract allows a data-free probe (see
 *  export-pdf-monte-carlo.test.ts); without it we answer for the empty state. */
export function estimateScenarioChangesPageCount(data?: ScenarioChangesPageData): number {
  if (!data || data.isEmpty || data.units.length === 0) return 1;

  const showDetails = data.showExplanations;
  const blocks: number[] = [];
  for (const unit of data.units) {
    if (unit.kind === "row") {
      blocks.push(rowHeight(showDetails ? unit.row.detail.length : 0));
    } else {
      blocks.push(GROUP_BAND_PT);
      for (const r of unit.rows) blocks.push(rowHeight(showDetails ? r.detail.length : 0));
    }
  }

  let sheets = 1;
  let remaining = FIRST_SHEET_PT;
  for (const h of blocks) {
    if (h > remaining) {
      sheets += 1;
      remaining = LATER_SHEET_PT;
    }
    remaining -= h;
  }
  return sheets;
}
