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
 * Return the list of years for the bar chart — 2 before / selected / 2 after,
 * clamped to the available projection years. If the selected year is not in
 * the list, returns an empty array.
 */
export function sliceBarWindow(years: number[], selected: number): number[] {
  const idx = years.indexOf(selected);
  if (idx < 0) return [];
  const start = Math.max(0, idx - 2);
  const end = Math.min(years.length, idx + 3); // inclusive of idx+2
  return years.slice(start, end);
}
