export type CrmTaskRecurrence = "none" | "weekly" | "monthly" | "quarterly";

/**
 * Returns the next due date when a recurring task completes.
 * - `none` or `currentDue === null` → returns null (no follow-on).
 * - `weekly` → +7 days.
 * - `monthly` / `quarterly` → +1 / +3 calendar months with end-of-month clamp
 *   (Jan 31 + 1mo = Feb 28 in non-leap years).
 *
 * Inputs/outputs are ISO `YYYY-MM-DD` strings — Drizzle's `date` round-trips as string.
 */
export function nextDueDate(
  recurrence: CrmTaskRecurrence,
  currentDue: string | null,
): string | null {
  if (recurrence === "none" || currentDue === null) return null;
  const [y, m, d] = currentDue.split("-").map(Number);

  if (recurrence === "weekly") {
    const dt = new Date(Date.UTC(y, m - 1, d + 7));
    return dt.toISOString().slice(0, 10);
  }

  const monthDelta = recurrence === "monthly" ? 1 : 3;
  const targetMonthIdx = m - 1 + monthDelta;
  const targetYear = y + Math.floor(targetMonthIdx / 12);
  const normalizedMonth = ((targetMonthIdx % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTarget);
  return `${targetYear.toString().padStart(4, "0")}-${(normalizedMonth + 1).toString().padStart(2, "0")}-${clampedDay.toString().padStart(2, "0")}`;
}
