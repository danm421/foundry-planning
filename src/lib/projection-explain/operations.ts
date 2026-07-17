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

export function compareToReference(): never {
  throw new Error("compareToReference is implemented in Task 9");
}
