/**
 * Pure transform from `(leftTree, leftResult, rightTree, rightResult)` into
 * chart series for the trajectory chart consumed by Task 28's TrajectoryChart
 * component.
 *
 * Each side carries its own tree because the two scenarios may differ in
 * accounts/owners/entities. Sharing one tree leaks right-only entities into
 * the left series at their initial values, hiding the wealth shift the chart
 * is meant to visualize.
 *
 * For each projection year, computes total household wealth (in-estate +
 * out-of-estate) less cumulative tax drag (federal/state estate tax + admin
 * expenses) accrued through that year. Returns parallel `right` / `left`
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
  /** [year, householdValue] pairs — Plan 2 / right column trajectory. */
  right: [year: number, value: number][];
  /** [year, householdValue] pairs — Plan 1 / left column trajectory. */
  left: [year: number, value: number][];
  /** Year of the first death event in the right-side projection (if any). */
  firstDeathYear?: number;
  /** Year of the second death event in the right-side projection (if any). */
  secondDeathYear?: number;
  /** Lower y-axis bound. Always 0. */
  yMin: number;
  /** Upper y-axis bound — max series value plus 5% headroom (or 1 if empty). */
  yMax: number;
}

/** Closed polygon (in chart-data space) representing a delta-band region. */
export interface DeltaBandPoly {
  points: [year: number, value: number][];
}

export interface DeltaBands {
  /** Regions where right > left (Plan 2 ahead of Plan 1). */
  positive: DeltaBandPoly[];
  /** Regions where right < left (Plan 2 behind Plan 1). */
  negative: DeltaBandPoly[];
}

export function deriveChartSeries(args: {
  leftTree: ClientData;
  leftResult: ProjectionResult;
  rightTree: ClientData;
  rightResult: ProjectionResult;
}): ChartSeries {
  const { leftTree, rightTree, rightResult, leftResult } = args;
  // Both sides share planStartYear; derive from rightTree by convention.
  const startYear = rightTree.planSettings.planStartYear;

  const buildSeries = (
    tree: ClientData,
    result: ProjectionResult,
  ): [year: number, value: number][] => {
    const giftEvents = tree.giftEvents ?? [];
    return result.years.map((py) => {
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
  };

  const rightSeries = buildSeries(rightTree, rightResult);
  const leftSeries = buildSeries(leftTree, leftResult);

  // Defensive: if either series is empty, Math.max(...[]) is -Infinity. Coalesce
  // to 1 so the chart can still render an empty axis.
  const allValues = [
    ...rightSeries.map((p) => p[1]),
    ...leftSeries.map((p) => p[1]),
  ];
  const yMax = allValues.length > 0 ? Math.max(...allValues) * 1.05 : 1;

  return {
    right: rightSeries,
    left: leftSeries,
    firstDeathYear: rightResult.firstDeathEvent?.year,
    secondDeathYear: rightResult.secondDeathEvent?.year,
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

/**
 * Build the delta-band geometry between two parallel year-aligned series.
 *
 * For each adjacent pair of years, emit a quad bounded by the right line
 * (top when right > left) and the left line (bottom). When the sign of
 * `right − left` flips between two years, linearly interpolate the zero
 * crossing and split the region into two triangles — one positive, one
 * negative — so the band edges meet cleanly at the crossing.
 */
export function deriveDeltaBands(
  left: [number, number][],
  right: [number, number][],
): DeltaBands {
  const positive: DeltaBandPoly[] = [];
  const negative: DeltaBandPoly[] = [];

  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n - 1; i++) {
    const [ya, la] = left[i];
    const [yb, lb] = left[i + 1];
    const ra = right[i][1];
    const rb = right[i + 1][1];
    const da = ra - la;
    const db = rb - lb;

    if (da >= 0 && db >= 0) {
      positive.push({
        points: [
          [ya, ra],
          [yb, rb],
          [yb, lb],
          [ya, la],
        ],
      });
    } else if (da <= 0 && db <= 0) {
      negative.push({
        points: [
          [ya, la],
          [yb, lb],
          [yb, rb],
          [ya, ra],
        ],
      });
    } else {
      const denom = da - db;
      const t = denom === 0 ? 0.5 : da / denom;
      const yCross = ya + t * (yb - ya);
      const vCross = ra + t * (rb - ra);
      if (da > 0) {
        positive.push({
          points: [
            [ya, ra],
            [yCross, vCross],
            [ya, la],
          ],
        });
        negative.push({
          points: [
            [yCross, vCross],
            [yb, lb],
            [yb, rb],
          ],
        });
      } else {
        negative.push({
          points: [
            [ya, la],
            [yCross, vCross],
            [ya, ra],
          ],
        });
        positive.push({
          points: [
            [yCross, vCross],
            [yb, rb],
            [yb, lb],
          ],
        });
      }
    }
  }

  return { positive, negative };
}
