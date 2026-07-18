// src/lib/projection-explain/operations.ts
// Metric-agnostic engine operations backing COMPOSITION/LEVEL. `explain.ts`
// owns the full DELTA assembly inline — its diff+detector pass needs the real
// death years, so no separate diff seam exists here (a null-death-year
// `diffYears` shipped in Task 1 and was removed as dead code at the simplify
// pass; rebuild it WITH death-year params if Phase 2 ever needs it).
import type { ProjectionYear } from "@/engine/types";
import type { Component, DrillContext, SubjectAdapter } from "./types";

export function composeYear(
  adapter: SubjectAdapter,
  year: ProjectionYear,
  ctx: DrillContext,
): Component[] {
  return adapter.components(year, ctx);
}

/** LEVEL primitive: compare a year's figure to a resolved reference set.
 *  Pure — `explainComposition` resolves WHICH figures form the reference
 *  (prior year, plan-wide mean, working-years mean, or a named year); this
 *  averages them and returns the signed delta. `referenceFigures` MUST be
 *  non-empty (the caller degrades honestly when no reference resolves).
 *  A reusable seam Phase 2 leans on. */
export function compareToReference(
  figure: number,
  referenceFigures: number[],
): { figure: number; referenceFigure: number; delta: number } {
  const referenceFigure =
    referenceFigures.reduce((sum, v) => sum + v, 0) / referenceFigures.length;
  return { figure, referenceFigure, delta: figure - referenceFigure };
}
