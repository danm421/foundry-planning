import { tickStep, ticks } from "d3-array";

/** How many gridlines the presentation charts aim for. */
export const AXIS_TICK_COUNT = 5;

/**
 * The top of a value axis: the smallest multiple of d3's own tick step that
 * clears the data.
 *
 * The rule this replaces rounded up to the next multiple of the LEADING
 * digit's magnitude — so a peak of $1.03M asked for a $2.0M axis and the chart
 * drew its bars in the bottom half of the panel, which is how the Sheskier
 * deck's retirement cash-flow sheet printed $1.0M bars under a $2.0M ceiling.
 * Landing on a tick step also guarantees the top gridline is labelled.
 */
export function niceAxisMax(value: number, tickCount: number = AXIS_TICK_COUNT): number {
  if (!(value > 0)) return 1;
  const step = tickStep(0, value, tickCount);
  // The epsilon keeps a value that already sits exactly on a step from adding
  // a whole empty step of headroom through binary-float drift.
  return Math.ceil(value / step - 1e-9) * step;
}

/** The gridlines for an axis topped by `niceAxisMax`. */
export function axisTicks(max: number, tickCount: number = AXIS_TICK_COUNT): number[] {
  return ticks(0, max, tickCount);
}

/**
 * Which bands of a categorical (year) axis get a label.
 *
 * Two failures this exists to stop, both seen in one client deck: a run of
 * evenly spaced labels that stops short of the data, so the chart's last bar
 * has no year against it ("the axis ends '74, the bars end '84"); and a pinned
 * label — the retirement year, the final year — landing beside a regular one
 * and printing `'49'50`.
 *
 * Pinned bands always win. A regular band is dropped when it sits within
 * `minGap` of a pinned one.
 */
export function bandLabelIndices(
  count: number,
  opts: { every: number; minGap: number; pinned?: readonly number[] },
): number[] {
  if (count <= 0) return [];
  const last = count - 1;
  const pinned = [...new Set([...(opts.pinned ?? []), last])]
    .filter((i) => i >= 0 && i <= last)
    .sort((a, b) => a - b);
  const every = Math.max(1, opts.every);
  const out = new Set(pinned);
  for (let i = 0; i <= last; i += every) {
    if (pinned.some((p) => Math.abs(p - i) < opts.minGap)) continue;
    out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}
