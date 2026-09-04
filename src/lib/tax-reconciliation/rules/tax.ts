import { makeDelta, money, planToTaxYear, ref } from "../compare";
import type { Check, ReconciliationInput, RuleResult, Suggestion } from "../types";

/** The sections whose gaps are INCOME the tax follows. A deduction or a filing-status finding moves
 *  the tax too, but naming one here would tell the advisor to chase the wrong card first. */
const INCOME_SIDE = new Set(["income", "business", "spending"]);

/** Not a plain `Rule`: it takes the suggestions the other rules already produced, so the federal-tax
 *  card can name the three largest income gaps behind the difference instead of restating it.
 *  `build.ts` therefore runs this one last. */
export function taxRules(input: ReconciliationInput, others: Suggestion[]): RuleResult {
  const { facts, taxYear, planYear, engineYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  const tax = facts.tax.totalTax;
  if (tax != null && engineYear?.taxResult) {
    const p = planToTaxYear(input, engineYear.taxResult.flow.totalFederalTax);
    const gap = Math.abs(tax - p);
    const id = "tax.federal";
    const fig = { returnFigure: { label: "Federal tax", amount: tax, display: money(tax), lineRefs: [ref("1040", "24", "Total tax", tax)] }, planFigure: { label: "Federal tax in the plan", amount: p, display: money(p), year: planYear } };
    if (gap > 2_000 && gap > 0.15 * Math.max(tax, 1)) {
      const top = others.filter((s) => INCOME_SIDE.has(s.section) && s.delta.amount != null).sort((a, b) => Math.abs(b.delta.amount!) - Math.abs(a.delta.amount!)).slice(0, 3);
      const where = top.length ? ` Where the difference comes from: ${top.map((s) => `${s.returnFigure.label} (${s.delta.display.toLowerCase()})`).join("; ")}.` : "";
      suggestions.push({ id, section: "tax", kind: "info", status: "open", headline: `The ${taxYear} return paid ${money(tax)} of federal tax; the plan computes ${money(p)} for ${planYear}.`, meaning: `The tax follows the income, so fix the income cards first and this gap closes on its own.${where}`, ...fig, delta: makeDelta(tax, p) });
    } else checks.push({ id, label: "Federal tax", returnDisplay: money(tax), planDisplay: money(p) });
  }
  // The settlement is a pure return-side fact — how the year was withheld, not what it cost — so it
  // needs no engine year and carries no plan number to compare against.
  const refund = facts.payments.refund, owed = facts.payments.amountOwed;
  if ((refund != null && refund > 5_000) || (owed != null && owed > 5_000)) {
    const isRefund = (refund ?? 0) > 5_000;
    const amt = isRefund ? refund! : owed!;
    suggestions.push({ id: "tax.settlement", section: "tax", kind: "info", status: "open",
      headline: isRefund ? `The household was refunded ${money(amt)} at filing.` : `The household owed ${money(amt)} at filing.`,
      meaning: isRefund ? "A large refund is withholding the household could have kept during the year." : "A large balance due points to under-withholding or missed estimates; the plan pays tax as it goes, so this does not change it.",
      returnFigure: { label: isRefund ? "Refund" : "Amount owed", amount: amt, display: money(amt), lineRefs: [ref("1040", isRefund ? "34" : "37", isRefund ? "Refund" : "Amount you owe", amt)] },
      planFigure: { label: "Plan", amount: null, display: "Pays as it goes", year: planYear }, delta: { amount: null, display: "—", tone: "neutral" } });
  }
  return { suggestions, checks };
}
