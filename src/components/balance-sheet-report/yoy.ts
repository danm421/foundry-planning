export type YoyBadge = "up" | "down" | "flat";

export interface YoyResult {
  /** Percent change as a number (e.g. 10 = +10%). */
  value: number;
  badge: YoyBadge;
}

const FLAT_THRESHOLD = 0.05; // percent

export function yoyPct(
  current: number,
  prior: number | null | undefined,
): YoyResult | null {
  if (prior == null || prior === 0) return null;
  const rawValue = ((current - prior) / Math.abs(prior)) * 100;
  // Round to 2 decimal places to avoid floating-point precision issues
  const value = Math.round(rawValue * 100) / 100;
  let badge: YoyBadge;
  if (Math.abs(value) <= FLAT_THRESHOLD) badge = "flat";
  else if (value > 0) badge = "up";
  else badge = "down";
  return { value, badge };
}

/**
 * Return the bar-chart anchor years: current, current+10, current+20, and
 * the last projection year (only if the projection extends more than 20
 * years past current — otherwise "last" would duplicate +20). Each anchor is
 * included only if that year is in `years`. Result is sorted ascending and
 * deduplicated.
 *
 * Examples:
 *   sliceBarAnchors([2026..2055], 2026) → [2026, 2036, 2046, 2055]
 *   sliceBarAnchors([2026..2046], 2026) → [2026, 2036, 2046]  (last = +20, no extra)
 *   sliceBarAnchors([2026..2035], 2026) → [2026]              (no +10 available)
 *   sliceBarAnchors([2040..2055], 2050) → [2050]              (projection ends at 2055)
 */
export function sliceBarAnchors(years: number[], current: number): number[] {
  if (years.length === 0) return [];
  const yearsSet = new Set(years);
  const lastY = years[years.length - 1];
  const anchors = new Set<number>();

  if (yearsSet.has(current)) anchors.add(current);
  if (yearsSet.has(current + 10)) anchors.add(current + 10);
  if (yearsSet.has(current + 20)) anchors.add(current + 20);
  if (lastY > current + 20 && yearsSet.has(lastY)) anchors.add(lastY);

  return [...anchors].sort((a, b) => a - b);
}
