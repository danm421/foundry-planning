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
