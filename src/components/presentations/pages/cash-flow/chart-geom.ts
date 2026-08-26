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
 * Where one legend entry sits, relative to the legend's own origin.
 *
 * Wraps. The row is 85pt per item over a 540pt canvas whose legend starts at
 * the left margin, so a 7th item on one row is placed beyond the SVG's right
 * edge and disappears WITHOUT ERROR — which is how the Monthly Cash Flow
 * chart's income line lost its name in the first render of it. Pure and
 * exported so the wrap is provable with nothing rendered; the component reads
 * these numbers rather than restating them.
 */
export const LEGEND_PER_ROW = 6;
export const LEGEND_ITEM_W = 85;
export const LEGEND_ROW_H = 11;

export function legendSlot(index: number): { x: number; y: number } {
  return {
    x: (index % LEGEND_PER_ROW) * LEGEND_ITEM_W,
    y: Math.floor(index / LEGEND_PER_ROW) * LEGEND_ROW_H,
  };
}
