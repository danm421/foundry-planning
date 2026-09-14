"use client";

import { useMemo } from "react";
import type {
  EstateTaxResult,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";
import type { EstateTaxColumnData } from "@/lib/estate/diff-estate-tax";

/**
 * What one tax-report column reports upward: BOTH deaths plus the engine's
 * household totals, so the second-death card and the grand total carry deltas
 * too — not just the first death's breakdown.
 *
 * The Estate Tax and State Death Tax views both call this, so the hazard below
 * is solved once instead of once per view.
 *
 * **The result MUST keep its identity between renders.** The shell compares a
 * column's reported `data` by IDENTITY (`estate-compare-shell.tsx`,
 * `nextReport`), so a freshly-built object each render re-reports forever and
 * loops the browser. Every argument here is a boolean or a reference INTO the
 * fetched projection, so this memo holds for as long as that projection does.
 *
 * `isSplit` is passed explicitly rather than inferred from which of the other
 * arguments is set: the caller establishes that invariant fifteen lines away,
 * and a contract that reads it back out would silently depend on it.
 */
export function useEstateTaxColumnData(
  isSplit: boolean,
  splitFirst: EstateTaxResult | null,
  splitSecond: EstateTaxResult | null,
  activeOrdering: HypotheticalEstateTaxOrdering | null,
): EstateTaxColumnData | null {
  return useMemo(() => {
    if (isSplit) {
      return splitFirst
        ? { firstDeath: splitFirst, finalDeath: splitSecond ?? null, totals: null }
        : null;
    }
    return activeOrdering
      ? {
          firstDeath: activeOrdering.firstDeath,
          finalDeath: activeOrdering.finalDeath ?? null,
          totals: activeOrdering.totals,
        }
      : null;
  }, [isSplit, splitFirst, splitSecond, activeOrdering]);
}
