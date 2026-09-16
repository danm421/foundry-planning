import { toNumber } from "@/lib/extraction/numeric";

/**
 * The figure under one column of a review table.
 *
 * `missing` is the count of rows this sum could NOT cover — the gap the table
 * has to DISCLOSE rather than hide, because a total sitting under 25 rows
 * reads as covering all 25.
 *
 * The row COUNT is deliberately not here: it belongs to the table, not to a
 * column, and it would otherwise be restated identically by every totalled
 * column — two fields both claiming to be "the count", identical today and
 * free to diverge tomorrow.
 */
export interface ColumnTotal {
  /** Sum of the rows carrying a usable figure. */
  sum: number;
  /** Rows whose figure is absent or unreadable, so the sum cannot cover them. */
  missing: number;
}

/**
 * Total one column across the rows a table is showing.
 *
 * Generic over the row shape and keyed by column, so the accounts table totals
 * `value` while any sibling entity table totals whichever column its own spec
 * opts in — no entity-specific knowledge lives here.
 *
 * Reads each cell through the shared `toNumber` (`lib/extraction/numeric.ts`),
 * which is the same rule `placement.ts` coerces a model's observation by. That
 * matters for more than tidiness: a value the cell renders as a figure but this
 * function read as absent would put "excludes 1 without a value" under a column
 * where the advisor can plainly see the number.
 */
export function columnTotal(
  rows: readonly Record<string, unknown>[],
  key: string,
): ColumnTotal {
  let sum = 0;
  let missing = 0;
  for (const row of rows) {
    const figure = toNumber(row[key]);
    if (figure === null) missing += 1;
    else sum += figure;
  }
  return { sum, missing };
}
