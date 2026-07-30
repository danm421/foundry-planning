// src/lib/projection-explain/subjects/tax.ts
// The tax SubjectAdapter — wraps the migrated diff + detector internals behind
// the metric-agnostic SubjectAdapter seam.
import type { ProjectionYear } from "@/engine/types";
import { resolveSourceLabel } from "@/lib/tax/cell-drill/_shared";
import { LINE_FLOOR, RESIDUAL_TAX_LINE_LABEL, SOURCE_CAP, type Component, type DrillContext, type SubjectAdapter } from "../types";
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
 *
 *    RESIDUAL guard: the eight fields are not the whole bill. Two unlined terms
 *    move `flow.totalTax` in OPPOSITE directions:
 *      + SECA self-employment tax, a NINTH additive term the engine folds straight
 *        into `flow.totalTax`/`totalFederalTax` (src/engine/year-tax.ts:233-236)
 *        with no flow line field — `TaxResult["flow"]` has no `seTax` at all — so
 *        for self-employed clients the eight fields sum to `totalTax − seTax` and
 *        the gap is POSITIVE.
 *      − Federal credits. `flow.taxCredits` + `flow.refundableCredits` are netted
 *        out inside `totalFederalTax` (calculate.ts) while `regularFederalIncomeTax`
 *        stays PRE-credit by design, so for a household with credits the eight
 *        fields OVERSHOOT and the gap is NEGATIVE. Refundable credits are
 *        subtracted outside the zero floor, so `totalTax` itself can be negative.
 *    The guard is therefore on |gap|, not on gap: a one-sided `gap >= LINE_FLOOR`
 *    silently discards every credit-driven residual and breaks the sum invariant
 *    for exactly the households the credit layer was built for. The residual is
 *    computed from the engine's own `totalTax` — never recomputed.
 *    Sub-floor gaps (|gap| < LINE_FLOOR) are still dropped as noise.
 *
 *    ⚠️ WHY THIS SURFACE RECONCILES AND THE ITEMIZING TABLES DO NOT. The residual
 *    is a SUBTRACTION from the engine's own total, so it absorbs any unlined term
 *    automatically — including `seTax`, without ever naming it. The Other-Taxes
 *    tables (lib/tax/other-tax.ts and its two consumers) instead ENUMERATE flow
 *    fields, so they can only show what has a field: they carry the credits
 *    component but structurally cannot carry SECA. The two documents are not in
 *    conflict — this one holds unconditionally, that one holds for households
 *    without self-employment income. Don't "reconcile" them by weakening this.
 *
 *    The residual's label leads with the GENERIC term for that reason — see
 *    RESIDUAL_TAX_LINE_LABEL in ../types.ts, which is named for the set, not for
 *    SECA: the first household to see this line is typically a credit-claiming
 *    one with zero SE income.
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

  // Residual: capture any unlined term folded into totalTax — SECA (positive) or
  // netted federal credits (negative) — so the eight lines + residual reconcile to
  // the reported figure. Straight from flow.totalTax — no recompute. |gap|, not
  // gap: a one-sided guard drops the credit direction. See the header comment.
  const residual = Math.round(f.totalTax) - taxLineParts.reduce((s, p) => s + p.amount, 0);
  if (Math.abs(residual) >= LINE_FLOOR) {
    taxLineParts.push({
      label: RESIDUAL_TAX_LINE_LABEL,
      amount: residual,
      type: "tax_line",
    });
  }

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
