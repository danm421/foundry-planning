import { planToTaxYear } from "./compare";
import { RULES, taxRules } from "./rules";
import { SECTION_ORDER, SECTION_TITLES, type Check, type Pair, type Reconciliation, type ReconciliationInput, type Suggestion } from "./types";

/** Everything the builder cannot derive from the input: the extraction's state, the dismissals the
 *  advisor has already recorded, and any note the caller wants carried onto the page — the
 *  "projection couldn't run" note among them, which the loader raises because it is the side that
 *  knows why the run failed. No rule emits notes (`RuleResult` has no field for them), so a note
 *  reaches the page exactly once however many rules degraded. */
export interface BuildContext {
  status: Reconciliation["status"];
  dismissedIds: Set<string>;
  dismissalsUnavailable: boolean;
  notes: string[];
}

export function buildReconciliation(input: ReconciliationInput, ctx: BuildContext): Reconciliation {
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  for (const rule of RULES) {
    const r = rule(input);
    suggestions.push(...r.suggestions);
    checks.push(...r.checks);
  }
  // Last, and fed everything found so far: the federal-tax card names the three largest income-side
  // gaps rather than restating the difference, so it needs the other rules' output.
  const t = taxRules(input, suggestions);
  suggestions.push(...t.suggestions);
  checks.push(...t.checks);

  // Dismissals match the WHOLE id the rule emitted, never a prefix: a create arm carries its own
  // `.create` id so that setting aside "add this business" does not also silence "this business's
  // amount is off".
  const open = suggestions.filter((s) => !ctx.dismissedIds.has(s.id));
  const dismissed = suggestions.filter((s) => ctx.dismissedIds.has(s.id)).map((s) => ({ ...s, status: "dismissed" as const }));
  const sections = SECTION_ORDER
    .map((id) => ({ id, title: SECTION_TITLES[id], items: open.filter((s) => s.section === id) }))
    .filter((s) => s.items.length > 0);

  const notes = [...ctx.notes];
  if (input.planYear !== input.taxYear) {
    notes.push(`The plan's ${input.planYear} figures are shown in ${input.taxYear} dollars, using each row's own growth rate (the plan's inflation rate for engine totals).`);
  }

  const tr = input.engineYear?.taxResult;
  const planOf = (v: number | undefined): number | null => (v == null ? null : planToTaxYear(input, v));
  const returnAgi = input.facts.income.agi, returnTax = input.facts.tax.totalTax;
  const planAgi = planOf(tr?.flow.adjustedGrossIncome), planTax = planOf(tr?.flow.totalFederalTax);
  const rate = (tax: number | null, agi: number | null): number | null => (tax != null && agi != null && agi !== 0 ? tax / agi : null);
  const pair = (r: number | null, p: number | null): Pair => ({ return: r, plan: p });

  return {
    taxYear: input.taxYear, planYear: input.planYear, planStartYear: input.plan.planSettings.planStartYear,
    status: ctx.status,
    overview: {
      totalIncome: pair(input.facts.income.totalIncome, planOf(tr?.income.totalIncome)),
      federalTax: pair(returnTax, planTax),
      agi: pair(returnAgi, planAgi),
      effectiveRate: pair(rate(returnTax, returnAgi), rate(planTax, planAgi)),
      openCount: open.length, dismissedCount: dismissed.length, inLineCount: checks.length,
    },
    sections, checks, dismissed, notes,
    dismissalsUnavailable: ctx.dismissalsUnavailable,
  };
}
