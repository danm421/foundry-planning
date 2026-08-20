/**
 * Axis-density rules shared by the portal's monthly line charts.
 */

/**
 * Years between x-axis labels, given the number of monthly points.
 *
 * A calculator's horizon is not knowable in advance — a goal can be two years
 * out or forty, a paydown can run to the fifty-year ceiling — so a fixed
 * one-a-year rule draws four labels on one chart and fifty overlapping ones on
 * the next. Step up a 1/2/5 ladder until at most eight labels remain.
 */
export function yearTickStep(points: number): number {
  const spans = Math.max(1, points - 1);
  return [1, 2, 5, 10, 25].find((step) => Math.floor(spans / (12 * step)) + 1 <= 8) ?? 50;
}
