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

/**
 * An income/expense dialog's body as a scenario `edit`'s fields: without
 * `inflationStartYear` when its null only restates the row's "inflate from the
 * start year". The base often stores that as the start year itself (both read
 * as not-today's-dollars here), so sending the null recorded
 * `inflationStartYear: 2026 → null` for an edit that never touched it. A moved
 * start year still sends the null — the stored year would then mean today's
 * dollars — and so does switching today's dollars off.
 */
export function withoutRestatedInflationStart<
  T extends { inflationStartYear: number | null; startYear: string | number },
>(body: T, row: { inflationStartYear?: number | null; startYear: number }): Record<string, unknown> {
  const restated =
    body.inflationStartYear === null &&
    Number(body.startYear) === row.startYear &&
    !isTodaysDollars(row.inflationStartYear, row.startYear);
  if (!restated) return body;
  const fields: Record<string, unknown> = { ...body };
  delete fields.inflationStartYear;
  return fields;
}
