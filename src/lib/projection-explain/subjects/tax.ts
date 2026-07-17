// src/lib/projection-explain/subjects/tax.ts
// The tax SubjectAdapter — wraps the migrated diff + detector internals behind
// the metric-agnostic SubjectAdapter seam.
import type { ProjectionYear } from "@/engine/types";
import type { Component, DrillContext, SubjectAdapter } from "../types";
import { diffTaxYears, type TaxYearDiff } from "./tax-diff";
import { DETECTORS } from "./tax-detectors";

export const taxAdapter: SubjectAdapter = {
  key: "tax",
  figureLabel: "Total tax",
  figure: (y) => y.taxResult?.flow.totalTax ?? null,
  degradedFigure: (y) => y.expenses.taxes,
  components: (y, ctx) => taxComponents(y, ctx), // implemented in Task 8
  // The generic CauseDetector types `diff` as `unknown`; the tax detectors
  // narrow it to TaxYearDiff at their boundary. This cast is that narrowing
  // seam — `buildDiff` always feeds these detectors a TaxYearDiff at runtime.
  detectors: DETECTORS as SubjectAdapter["detectors"],
  buildDiff: (prev, next, ctx) => diffTaxYears(prev, next, ctx),
  estimateRate: (diff) => (diff as TaxYearDiff).blendedRate,
  deltaExtras: (diff) => {
    const d = diff as TaxYearDiff;
    return {
      taxLineDeltas: d.taxLineDeltas,
      incomeDeltas: d.incomeDeltas,
      sourceDeltas: d.sourceDeltas,
      withdrawalPicture: d.withdrawalPicture,
      marginalFederalRate: d.marginalFederalRate,
    };
  },
};

// Placeholder until Task 8 fills COMPOSITION; keep the type honest now.
function taxComponents(_y: ProjectionYear, _ctx: DrillContext): Component[] {
  return [];
}
