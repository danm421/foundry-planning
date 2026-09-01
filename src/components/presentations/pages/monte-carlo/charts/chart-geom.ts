// Where the three Monte Carlo charts put things along x.
//
// Exported so a geometry guard can ask where a year or a bar actually is
// without restating the range or the padding. The x-axis ticks and the bar
// labels have to sit on the thing they name, and a test that recomputed those
// positions from its own copy of these numbers would go on passing after the
// charts changed underneath it.
import { scaleBand, scalePoint } from "d3-scale";
import type { FanChartSpec, SuccessChartSpec } from "@/lib/presentations/charts/monte-carlo-specs";

/** Inner plot width. The margins are in unscaled points, so a thumbnail keeps
 *  the full-size gutter while its type shrinks — labels only ever get slacker. */
export function innerWidth(spec: { width: number; margin: { left: number; right: number } }, scale = 1) {
  return spec.width * scale - spec.margin.left - spec.margin.right;
}

/** The point scale the fan chart's years sit on. */
export function fanXScale(spec: FanChartSpec, scale = 1) {
  return scalePoint<number>().domain(spec.years).range([0, innerWidth(spec, scale)]);
}

/** The band scale the success chart's bars are laid out on. */
export function successBandScale(spec: SuccessChartSpec, scale = 1) {
  return scaleBand<number>()
    .domain(spec.bars.map((_, i) => i))
    .range([0, innerWidth(spec, scale)])
    .padding(0.08);
}
