import type { FindingContext } from "../types";

/**
 * Every estimatedImpact that is "tax at the margin" resolves its rate here, so
 * one fallback rule exists instead of a per-builder ternary. The engine's
 * derived rate is preferred; the bracket map is the fallback for a return the
 * engine could not run (no filing status); null when neither is available, in
 * which case the caller's estimatedImpact is null rather than zero.
 */
export function marginalRateFor(ctx: FindingContext): number | null {
  return ctx.calc?.diag.marginalFederalRate ?? ctx.bracketMap?.ordinary.marginalRate ?? null;
}

/** Tax on `amount` at the return's marginal rate. Null — never 0 — when the
 *  rate is unknown, so "we can't size this" never renders as "$0". */
export function taxOn(amount: number, ctx: FindingContext): number | null {
  const rate = marginalRateFor(ctx);
  return rate == null ? null : amount * rate;
}
