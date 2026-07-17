// src/lib/projection-explain/subjects/tax.ts
// The tax SubjectAdapter — wraps the migrated diff + detector internals behind
// the metric-agnostic SubjectAdapter seam.
import type { ProjectionYear } from "@/engine/types";
import { resolveSourceLabel } from "@/lib/tax/cell-drill/_shared";
import { SOURCE_CAP, type Component, type DrillContext, type SubjectAdapter } from "../types";
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

/** Decompose one year's tax bill into two component families:
 *
 *  - `tax_line` parts — the pieces of the bill itself. Their (rounded) sum IS
 *    `flow.totalTax`: post-fold, `totalTax = regular fed + cap gains + AMT + NIIT
 *    + additional Medicare + FICA + early-withdrawal penalty + state` (the
 *    penalty is layered onto flow in projection.ts). This mirrors tax-diff.ts's
 *    `taxLines` verbatim — INCLUDING FICA — so the DELTA and COMPOSITION layers
 *    agree and the sum invariant holds. Nonzero-only; the dropped fields are 0,
 *    so filtering them never moves the sum.
 *  - `income_source` parts — the recognized income DRIVING the tax, source-keyed
 *    and labeled via `resolveSourceLabel`, largest-|amount| first, capped at
 *    SOURCE_CAP. Kept as a distinct type so a consumer never sums them into the
 *    tax total.
 *
 *  Degrade-first: no `taxResult` ⇒ a single untyped `{ label: "Total tax",
 *  amount: expenses.taxes }`. It carries no `type`, so it is never counted as a
 *  tax_line. */
function taxComponents(y: ProjectionYear, ctx: DrillContext): Component[] {
  const tr = y.taxResult;
  if (!tr) return [{ label: "Total tax", amount: Math.round(y.expenses.taxes) }];

  const f = tr.flow;
  const taxLineParts: Component[] = (
    [
      ["Regular federal income tax", f.regularFederalIncomeTax],
      ["Capital gains tax", f.capitalGainsTax],
      ["AMT", f.amtAdditional],
      ["NIIT", f.niit],
      ["Additional Medicare", f.additionalMedicare],
      ["FICA", f.fica],
      ["Early-withdrawal penalty", f.earlyWithdrawalPenalty],
      ["State tax", f.stateTax],
    ] as const
  )
    .map(([label, amount]) => ({ label, amount: Math.round(amount), type: "tax_line" }))
    .filter((p) => p.amount !== 0);

  const bySource = y.taxDetail?.bySource ?? {};
  const sourceParts: Component[] = Object.entries(bySource)
    .map(([sourceId, v]) => ({
      label: resolveSourceLabel(sourceId, ctx),
      amount: Math.round(v.amount),
      sourceId,
      type: "income_source",
    }))
    .filter((p) => p.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, SOURCE_CAP);

  return [...taxLineParts, ...sourceParts];
}
