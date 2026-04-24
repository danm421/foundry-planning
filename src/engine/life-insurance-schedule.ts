import type { LifeInsuranceCashValueScheduleRow } from "./types";

/**
 * Resolve the cash value for a given year from a free-form schedule.
 *
 * - Exact year → row value.
 * - Between two rows → linear interpolation.
 * - Before first row → flat-back at first row's value.
 * - After last row → flat-forward at last row's value.
 * - Empty schedule → throws.
 */
export function resolveCashValueForYear(
  schedule: LifeInsuranceCashValueScheduleRow[],
  year: number,
): number {
  if (schedule.length === 0) {
    throw new Error("resolveCashValueForYear: empty cash-value schedule");
  }

  const sorted = [...schedule].sort((a, b) => a.year - b.year);

  if (year <= sorted[0].year) return sorted[0].cashValue;
  if (year >= sorted[sorted.length - 1].year) {
    return sorted[sorted.length - 1].cashValue;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (year >= lo.year && year <= hi.year) {
      if (year === lo.year) return lo.cashValue;
      if (year === hi.year) return hi.cashValue;
      const t = (year - lo.year) / (hi.year - lo.year);
      return lo.cashValue + t * (hi.cashValue - lo.cashValue);
    }
  }

  throw new Error("resolveCashValueForYear: unreachable");
}
