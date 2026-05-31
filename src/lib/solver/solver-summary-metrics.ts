// src/lib/solver/solver-summary-metrics.ts
//
// Pure read-only derivations over a projection's ProjectionYear[]. Used by the
// Solver KPI row. Mirrors the funded/tax logic the Retirement Analysis uses so
// the two tools report the same numbers.

import type { ProjectionYear } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";

/** Count of plan years whose liquid portfolio is non-negative (no shortfall). */
export function yearsFullyFunded(years: ProjectionYear[]): number {
  return years.filter((y) => liquidPortfolioTotal(y) >= 0).length;
}

/** Sum of per-year total taxes over the whole projection horizon. */
export function lifetimeTaxes(years: ProjectionYear[]): number {
  return years.reduce((sum, y) => sum + (y.expenses?.taxes ?? 0), 0);
}
