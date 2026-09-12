"use client";

import { useEffect, useMemo } from "react";
import type { ProjectionResult } from "@/engine/projection";
import type {
  EstateColumnMeta,
  EstateColumnReady,
} from "@/components/estate-compare-shell";

/**
 * One estate report column's side of the `EstateCompareShell` contract: derive
 * the column's projection metadata and report it, with the column's own report
 * data, up to the shell.
 *
 * Every report view that adopts the shell calls this, so the two hazards below
 * are solved once instead of once per view.
 *
 * 1. **`data` is compared by IDENTITY by the shell.** Pass a value that is
 *    stable between renders — a reference INTO the projection, or a memo.
 *    A freshly built object lands in this effect's dependency array, reports
 *    again on every render, and loops the browser.
 * 2. **A projection with no years has no `todayYear` to report.** Reporting
 *    the `0` placeholder would have the shell build its shared As-of control
 *    row around the year zero, so the column stays silent until it has years.
 *
 * `onReady` is optional because every compare prop is optional: standalone,
 * the view has no shell to report to and this hook does nothing.
 */
export function useEstateColumnReady<T>(
  projection: ProjectionResult | null,
  data: T | null,
  onReady?: (ready: EstateColumnReady<T>) => void,
): void {
  // Keyed on the projection alone: every field below is read off it, so `meta`
  // keeps its identity for as long as the projection does — which is what
  // keeps the effect below from re-reporting on an unrelated re-render.
  const meta = useMemo<EstateColumnMeta>(() => {
    const years = projection?.years ?? [];
    return {
      years: years.map((y) => y.year),
      todayYear: years[0]?.year ?? 0,
      firstDeathYear: projection?.firstDeathEvent?.year ?? null,
      secondDeathYear: projection?.secondDeathEvent?.year ?? null,
    };
  }, [projection]);

  useEffect(() => {
    if (!onReady || meta.years.length === 0) return;
    onReady({ meta, data });
  }, [onReady, meta, data]);
}
