// Pure stacking geometry for the presentation bar chart. Positive segments
// stack up from the zero line; negative segments stack down from it,
// tracked separately so diverging series (e.g. Portfolio Activity) render
// correctly. For all-positive data this matches a single-cumulative stack.

export interface BarRect {
  y: number;       // top edge in pixel space
  height: number;
}

export function stackRects(
  yScale: (value: number) => number,
  values: number[],
): BarRect[] {
  let pos = 0;
  let neg = 0;
  return values.map((v) => {
    let y0: number;
    let y1: number;
    if (v >= 0) {
      y0 = yScale(pos);
      y1 = yScale(pos + v);
      pos += v;
    } else {
      y0 = yScale(neg);
      y1 = yScale(neg + v);
      neg += v;
    }
    return { y: Math.min(y0, y1), height: Math.abs(y0 - y1) };
  });
}

/**
 * Where the legend entries sit, relative to the legend's own origin.
 *
 * The pitch is derived from the room the chart actually has, not fixed. The
 * fixed 85pt pitch it replaces was sized for one canvas: on the 540pt chart the
 * sixth label ran off the right edge and printed "Total Exper", and on the
 * 500pt retirement cash-flow panel it vanished entirely, leaving a black line
 * in the legend with no name beside it. An @react-pdf `Svg` child placed past
 * the viewport is simply not drawn — no error, no clipping artefact — so this
 * has to be right by construction.
 *
 * Pure and exported so the fit is provable with nothing rendered; the component
 * reads these numbers rather than restating them.
 */
export const LEGEND_ROW_H = 11;
/** Marker width plus its gap — where each label starts inside its slot. */
export const LEGEND_LABEL_X = 14;
/** Marker, gap and the longest label the deck prints, at 7pt Inter. */
export const LEGEND_MIN_ITEM_W = 78;

export interface LegendLayout {
  perRow: number;
  itemW: number;
  rows: number;
}

export function legendLayout(count: number, availableW: number): LegendLayout {
  const fit = Math.floor(availableW / LEGEND_MIN_ITEM_W);
  const perRow = Math.max(1, Math.min(Math.max(count, 1), fit));
  return { perRow, itemW: availableW / perRow, rows: Math.ceil(Math.max(count, 1) / perRow) };
}

export function legendSlot(index: number, layout: LegendLayout): { x: number; y: number } {
  return {
    x: (index % layout.perRow) * layout.itemW,
    y: Math.floor(index / layout.perRow) * LEGEND_ROW_H,
  };
}
