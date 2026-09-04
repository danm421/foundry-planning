import { planToTaxYear } from "./compare";
import { RULES, taxRules } from "./rules";
import { SECTION_ORDER, SECTION_TITLES, type Check, type Pair, type Reconciliation, type ReconciliationInput, type RuleResult, type Suggestion } from "./types";

/** Everything the builder cannot derive from the input: the extraction's state, the dismissals the
 *  advisor has already recorded, and any note the caller wants carried onto the page — the
 *  "projection couldn't run" note among them, which the loader raises because it is the side that
 *  knows why the run failed. It arrives exactly once however many rules degraded, because no rule
 *  can emit a note — `RuleResult` has no field for one. The builder appends one note of its own
 *  after these, for any rule that threw. */
export interface BuildContext {
  status: Reconciliation["status"];
  dismissedIds: Set<string>;
  dismissalsUnavailable: boolean;
  notes: string[];
}

export function buildReconciliation(input: ReconciliationInput, ctx: BuildContext): Reconciliation {
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  const notes = [...ctx.notes];

  // These facts come off scanned PDFs, so a shape no rule anticipated is a live risk — and one rule
  // throwing must not blank the whole page. Catch it and DISCLOSE it: a silent hole would read as
  // "the plan agrees about this", which is the one thing it must never say. The advisor gets a note
  // naming what went unchecked; the logs get the error. A rule that throws contributes nothing,
  // because its output is only pushed once it has returned.
  const run = (label: string, rule: () => RuleResult): void => {
    try {
      const r = rule();
      suggestions.push(...r.suggestions);
      checks.push(...r.checks);
    } catch (err) {
      console.error("[tax-reconciliation] rule threw, skipping it:", label, err);
      notes.push(`The ${label} checks could not run, so nothing on this page reflects them. Everything else was compared normally.`);
    }
  };

  for (const { label, rule } of RULES) run(label, () => rule(input));
  // Last, and fed everything found so far: the federal-tax card names the three largest income-side
  // gaps rather than restating the difference, so it needs the other rules' output. `suggestions`
  // includes dismissed cards on purpose — dismissing a card hides it, it does not un-find the gap
  // the tax difference actually came from.
  run("federal tax", () => taxRules(input, suggestions));

  // Dismissals match the WHOLE id the rule emitted, never a prefix: a create arm carries its own
  // `.create` id so that setting aside "add this business" does not also silence "this business's
  // amount is off".
  const open = suggestions.filter((s) => !ctx.dismissedIds.has(s.id));
  const dismissed = suggestions.filter((s) => ctx.dismissedIds.has(s.id)).map((s) => ({ ...s, status: "dismissed" as const }));
  const sections = SECTION_ORDER
    .map((id) => ({ id, title: SECTION_TITLES[id], items: open.filter((s) => s.section === id) }))
    .filter((s) => s.items.length > 0);

  // No units note. Every plan figure IS stated in taxYear dollars, but saying so
  // is the renderer's job: the page labels its own columns and carries the
  // explanation on the strip, so emitting it here printed the same sentence
  // twice, in different words, one line apart. `notes` is for what the page
  // cannot know — a rule that threw, a projection that did not run.

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
