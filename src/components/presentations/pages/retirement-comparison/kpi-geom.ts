// Pure geometry for the page-1 headline KPI strip.
//
// The strip is a row of equal-width cards. Nothing in a rendered PDF marks
// where one card's content box ends — the border is drawn, not written — so a
// value that runs past its own card and over its neighbour is invisible to
// every assertion the suite can make about text. That is not hypothetical: at
// five cards a card is ~82pt wide and a rate-valued pair ("$170K/yr →
// $175K/yr") needs ~114pt, and it shipped, clearing tsc, eslint and 2722 green
// tests.
//
// So the numbers live here, `page-pdf.tsx` reads them rather than restating
// them, and `kpi-card-boxes.test.tsx` measures a real render against the boxes
// this file derives. Same contract as `chart-geom.ts` next door: pure and
// exported so the fit is provable with nothing rendered.
import { PAGE_PAD_X, PAGE_WIDTH_PORTRAIT } from "@/components/presentations/shared/page-frame";

/** Space between two cards. */
export const KPI_GAP = 6;
/** Each card's own padding, all four sides. */
export const KPI_PAD = 8;
/** Each card's border. Drawn inside the card box by react-pdf. */
export const KPI_BORDER = 1;

/** Card edge → where its text may start. */
export const KPI_CHROME = KPI_BORDER + KPI_PAD;

/** The width the strip has to divide up. */
export const KPI_ROW_WIDTH = PAGE_WIDTH_PORTRAIT - 2 * PAGE_PAD_X;

export interface KpiCardBox {
  /** Leftmost x a glyph in this card may occupy. */
  left: number;
  /** Rightmost x a glyph in this card may occupy. Past this it is over the
   *  card's own border, and past `left` of the next card it is over the
   *  neighbour's text. */
  right: number;
}

/**
 * The content box of each card when `count` of them share the row.
 *
 * `flex: 1` on every card splits the row evenly after the gaps are taken out,
 * which is `n * outer + (n - 1) * gap = rowWidth`.
 */
export function kpiCardBoxes(count: number, rowWidth = KPI_ROW_WIDTH): KpiCardBox[] {
  if (count <= 0) return [];
  const outer = (rowWidth - (count - 1) * KPI_GAP) / count;
  return Array.from({ length: count }, (_, i) => {
    const edge = PAGE_PAD_X + i * (outer + KPI_GAP);
    return { left: edge + KPI_CHROME, right: edge + outer - KPI_CHROME };
  });
}
