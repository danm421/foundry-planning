import type { FindingContext } from "../types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { calcSeca } from "@/lib/tax/fica";
import { n } from "../adapter";

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

/**
 * Schedule SE tax on a given SE base, coordinated with W-2 wages already
 * subject to the Social Security cap.
 *
 * ⚠️ ALWAYS go through this. Do not hand-roll 15.3%, the 0.9235 multiplier, or
 * the wage-base coordination anywhere in findings/ — calcSeca is the one place
 * that arithmetic is tested, and a second copy will disagree with the engine
 * the moment a rate or the wage base moves.
 */
export function seTaxOn(seEarnings: number, ctx: FindingContext): number {
  return calcSeca({
    seEarnings,
    ssTaxRate: ctx.params.ssTaxRate,
    ssWageBase: ctx.params.ssWageBase,
    medicareTaxRate: ctx.params.medicareTaxRate,
    ficaSsWages: n(ctx.facts.income.wages),
  }).seTax;
}

/**
 * Schedule C profit across every business. Prefers the per-entity detail —
 * `businesses[]` is the breakdown of `income.scheduleCNet`, so summing both
 * would double-count — and falls back to the Schedule 1 line 3 aggregate for a
 * return extracted before per-business detail existed.
 */
export function totalScheduleCProfit(facts: TaxReturnFacts): number {
  if (facts.businesses.length > 0) {
    return facts.businesses.reduce((sum, b) => sum + n(b.netProfit), 0);
  }
  return n(facts.income.scheduleCNet);
}

/**
 * The base Schedule SE actually taxes: Schedule C profit plus partnership
 * guaranteed payments. S-corp box 1 is deliberately absent — an S-corp
 * distributive share carries no SE tax, which is the whole point of
 * s-corp-election and reasonable-compensation.
 */
export function selfEmploymentEarnings(facts: TaxReturnFacts): number {
  const guaranteed = facts.k1s.reduce((sum, k) => sum + n(k.guaranteedPayments), 0);
  return totalScheduleCProfit(facts) + guaranteed;
}
