import type { LifeInsuranceCashValueScheduleRow } from "./types";

type ScheduleColumn = "cashValue" | "premiumAmount" | "income" | "deathBenefit";

/**
 * Resolve a single schedule column for a year.
 *
 * - Only rows where `column` is defined participate.
 * - Exact year → row value.
 * - Between two rows → linear interpolation.
 * - Before first / after last → flat-extend.
 * - No row defines the column → null.
 */
export function resolveScheduledColumnForYear(
  schedule: LifeInsuranceCashValueScheduleRow[],
  year: number,
  column: ScheduleColumn,
): number | null {
  const points = schedule
    .filter((r) => r[column] != null)
    .map((r) => ({ year: r.year, value: r[column] as number }))
    .sort((a, b) => a.year - b.year);

  if (points.length === 0) return null;
  if (year <= points[0].year) return points[0].value;
  if (year >= points[points.length - 1].year) {
    return points[points.length - 1].value;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    if (year >= lo.year && year <= hi.year) {
      if (year === lo.year) return lo.value;
      if (year === hi.year) return hi.value;
      const t = (year - lo.year) / (hi.year - lo.year);
      return lo.value + t * (hi.value - lo.value);
    }
  }
  return null;
}

/**
 * Back-compat cash-value resolver. Throws on empty schedule (existing
 * contract relied on by the projection's free-form override block).
 */
export function resolveCashValueForYear(
  schedule: LifeInsuranceCashValueScheduleRow[],
  year: number,
): number {
  const v = resolveScheduledColumnForYear(schedule, year, "cashValue");
  if (v == null) {
    throw new Error("resolveCashValueForYear: empty cash-value schedule");
  }
  return v;
}
