import type { ColumnDef } from "@tanstack/react-table";
import type { ProjectionYear } from "@/engine/types";

/**
 * Column ids that are never dropped even when their values are zero in every
 * year. `year` / `ages` are the always-present baseline columns; any column
 * whose id ends in `total` is a drill total; `wd_pct` is a ratio column where
 * a genuine 0% is meaningful information. `portfolio_boy` is the denominator
 * of the force-kept `wd_pct` ratio — dropping it (it reads 0 every year for a
 * plan with no investable portfolio) while keeping `wd_pct` would leave the
 * withdrawals drill-down showing a 0% ratio with its denominator invisible, so
 * the two must always be kept together.
 */
const ALWAYS_KEEP_COLUMN_IDS = new Set([
  "year",
  "ages",
  "wd_pct",
  "portfolio_boy",
]);

/** Below this dollar amount a currency cell rounds to "$0" when rendered. */
const ZERO_THRESHOLD = 0.5;

function isAllZeroColumn(
  colDef: ColumnDef<ProjectionYear>,
  allYears: ProjectionYear[],
): boolean {
  if (allYears.length === 0) return false;

  const id = typeof colDef.id === "string" ? colDef.id : "";
  if (ALWAYS_KEEP_COLUMN_IDS.has(id)) return false;
  if (/total$/i.test(id)) return false;

  const accessor = (
    colDef as { accessorFn?: (row: ProjectionYear, index: number) => unknown }
  ).accessorFn;
  if (!accessor) return false;

  for (let i = 0; i < allYears.length; i++) {
    const value = accessor(allYears[i], i);
    // A non-numeric accessor (e.g. the `ages` object) is not a value column —
    // keep it. A non-finite number (NaN/Infinity, e.g. an unguarded 0/0 ratio)
    // is treated conservatively as "not all-zero" so the column stays visible.
    // A value that rounds to a non-zero dollar — keep it.
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (Math.abs(value) >= ZERO_THRESHOLD) return false;
  }
  return true;
}

/**
 * Drop drill-down columns whose value is zero in every projection year. Pass
 * the *full* projection (not the visible slider window) so columns don't appear
 * and disappear as the year range changes.
 */
export function filterAllZeroColumns(
  columns: ColumnDef<ProjectionYear>[],
  allYears: ProjectionYear[],
): ColumnDef<ProjectionYear>[] {
  return columns.filter((c) => !isAllZeroColumn(c, allYears));
}
