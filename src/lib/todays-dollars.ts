/**
 * "Today's dollars" toggle ⇄ stored `inflationStartYear`.
 *
 * Income/expense amounts can be entered either in nominal dollars at the
 * entry's own start year, or in *today's* dollars — the current purchasing
 * power — which the engine then inflates forward from the plan's start year.
 * We persist that choice in a single nullable column:
 *
 *   - today's dollars  → `inflationStartYear = planStartYear`
 *   - nominal-at-start → `inflationStartYear = null`  (engine falls back to startYear)
 *
 * Recovering the checkbox state from the stored value is the subtle part. The
 * toggle is on whenever a basis year is stored that differs from the entry's
 * own start year — and that includes PAST-dated entries. An already-retired
 * client's expense may have started years ago (startYear = 2017) while its
 * amount is given in current dollars (inflationStartYear = planStartYear =
 * 2026), so the basis year is *greater* than startYear. An earlier
 * `inflationStartYear < startYear` test dropped exactly those entries, so
 * editing one un-checked the box and the next save reverted it to `null`,
 * inflating the current amount from the long-past start year.
 */
export function isTodaysDollars(
  inflationStartYear: number | null | undefined,
  startYear: number,
): boolean {
  return inflationStartYear != null && inflationStartYear !== startYear;
}
