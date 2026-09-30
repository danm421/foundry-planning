// The Tax Summary sheet's columns, in points — one source for the page that
// lays the panels out and the view-model that sizes the charts inside them.
//
// The columns are fixed widths, not flex percentages, because a chart is drawn
// at a fixed width: the taxes-by-year chart used to be 440pt wide in a panel
// that flexed to 366pt, and its last eight years printed under the right-hand
// panel where nobody could see them.
import { PAGE_PAD_X } from "@/components/presentations/shared/page-frame";

/** LETTER, landscape. */
const SHEET_W = 792;
const CONTENT_W = SHEET_W - 2 * PAGE_PAD_X;

export const COLUMN_GAP = 10;
export const PANEL_PAD = 10;
const PANEL_BORDER = 1;

export const LEFT_COL_W = Math.round((CONTENT_W - COLUMN_GAP) * 0.56);
export const RIGHT_COL_W = CONTENT_W - COLUMN_GAP - LEFT_COL_W;

/** The width a chart in the left panel spans: the column less its chrome. */
export const LEFT_CHART_W = LEFT_COL_W - 2 * (PANEL_PAD + PANEL_BORDER);

/** Taxes-by-year chart height — shorter when the bracket chart shares its panel. */
export const TAXES_CHART_H = 150;
export const TAXES_CHART_H_WITH_BRACKETS = 95;

/** The bracket chart's canvas. No timeline markers are drawn here, so the top
 *  margin only has to clear the top tick label; the bottom holds the year
 *  labels and up to three legend rows. */
export const BRACKET_CHART_FRAME = {
  width: LEFT_CHART_W,
  height: 185,
  margin: { top: 8, right: 8, bottom: 56, left: 40 },
};
