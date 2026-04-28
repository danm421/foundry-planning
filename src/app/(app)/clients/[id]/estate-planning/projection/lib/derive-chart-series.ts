/**
 * Pure transform from `(tree, withResult, withoutResult)` into chart series for
 * the trajectory chart consumed by Task 28's TrajectoryChart component.
 *
 * For each projection year, computes total household wealth (in-estate +
 * out-of-estate) less cumulative tax drag (federal/state estate tax + admin
 * expenses) accrued through that year. Returns parallel `with` / `without`
 * series, optional first/second death-year markers, and a y-axis range.
 *
 * No React, DOM, fetch, or DB — engine-adjacent helper. Lives here (and not
 * in `src/engine/`) because it's wired to the report UI; the engine itself
 * stays framework-free per AGENTS.md.
 */

import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  computeInEstateAtYear,
  computeOutOfEstateAtYear,
} from "@/lib/estate/in-estate-at-year";

export interface ChartSeries {
  /** [year, householdValue] pairs — with-plan trajectory. */
  with: [year: number, value: number][];
  /** [year, householdValue] pairs — no-plan counterfactual trajectory. */
  without: [year: number, value: number][];
  /** Year of the first death event in the with-plan projection (if any). */
  firstDeathYear?: number;
  /** Year of the second death event in the with-plan projection (if any). */
  secondDeathYear?: number;
  /** Lower y-axis bound. Always 0. */
  yMin: number;
  /** Upper y-axis bound — max series value plus 5% headroom (or 1 if empty). */
  yMax: number;
}

export function deriveChartSeries(args: {
  tree: ClientData;
  withResult: ProjectionResult;
  withoutResult: ProjectionResult;
}): ChartSeries {
  const { tree, withResult, withoutResult } = args;
  const startYear = tree.planSettings.planStartYear;
  const giftEvents = tree.giftEvents ?? [];

  const buildSeries = (
    result: ProjectionResult,
  ): [year: number, value: number][] =>
    result.years.map((py) => {
      const accountBalances = pyAccountBalances(py);
      const inE = computeInEstateAtYear({
        tree,
        giftEvents,
        year: py.year,
        projectionStartYear: startYear,
        accountBalances,
      });
      const outE = computeOutOfEstateAtYear({
        tree,
        giftEvents,
        year: py.year,
        projectionStartYear: startYear,
        accountBalances,
      });
      const drag = cumulativeTaxDrag(result, py.year);
      return [py.year, inE + outE - drag];
    });

  const withSeries = buildSeries(withResult);
  const withoutSeries = buildSeries(withoutResult);

  // Defensive: if either series is empty, Math.max(...[]) is -Infinity. Coalesce
  // to 1 so the chart can still render an empty axis.
  const allValues = [
    ...withSeries.map((p) => p[1]),
    ...withoutSeries.map((p) => p[1]),
  ];
  const yMax = allValues.length > 0 ? Math.max(...allValues) * 1.05 : 1;

  return {
    with: withSeries,
    without: withoutSeries,
    firstDeathYear: withResult.firstDeathEvent?.year,
    secondDeathYear: withResult.secondDeathEvent?.year,
    yMin: 0,
    yMax,
  };
}

// ---- helpers --------------------------------------------------------------

/**
 * Build the year-N account-balance map from `accountLedgers.endingValue`.
 *
 * Mirrors the helper in derive-scrubber-data.ts. Kept file-local for now —
 * if a third use site appears, extract to a shared module then.
 */
function pyAccountBalances(py: ProjectionYear): Map<string, number> {
  const balances = new Map<string, number>();
  for (const [accountId, ledger] of Object.entries(py.accountLedgers ?? {})) {
    balances.set(accountId, ledger.endingValue);
  }
  return balances;
}

/**
 * Sum `totalEstateTax + estateAdminExpenses` across all projection years up to
 * and including `cutoffYear`. Most projection years have `estateTax ===
 * undefined` (only death-event years populate it), hence the `?? 0` guards.
 *
 * Assumes `result.years` is sorted ascending by year (which `runProjection`
 * guarantees), so we can early-break once we pass the cutoff.
 */
function cumulativeTaxDrag(
  result: ProjectionResult,
  cutoffYear: number,
): number {
  let sum = 0;
  for (const py of result.years) {
    if (py.year > cutoffYear) break;
    sum += py.estateTax?.totalEstateTax ?? 0;
    sum += py.estateTax?.estateAdminExpenses ?? 0;
  }
  return sum;
}
