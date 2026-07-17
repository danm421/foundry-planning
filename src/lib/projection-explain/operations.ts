// src/lib/projection-explain/operations.ts
// Metric-agnostic engine operations. `explain.ts` owns the full DELTA assembly
// (with real death years); these are the thin, reusable public seams Phase 2
// leans on. COMPOSITION/LEVEL bodies land in Tasks 8–9.
import type { ProjectionYear } from "@/engine/types";
import type { Component, DrillContext, Finding, SubjectAdapter } from "./types";

export function diffYears(
  adapter: SubjectAdapter,
  prev: ProjectionYear,
  next: ProjectionYear,
  ctx: DrillContext,
): { diff: unknown; findings: Finding[] } {
  const diff = adapter.buildDiff(prev, next, ctx);
  const findings = adapter.detectors
    .map((d) => d({ prev, next, diff, ctx, firstDeathYear: null, secondDeathYear: null }))
    .filter((f): f is Finding => f != null);
  return { diff, findings };
}

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
