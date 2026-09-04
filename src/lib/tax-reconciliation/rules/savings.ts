import { ROW, detailsHref, differs, isActiveInYear, makeDelta, money, ref, sum } from "../compare";
import type { Check, ReconciliationInput, Rule, Suggestion } from "../types";

/** One Schedule 1 adjustment that is really a contribution the plan should be making: the account
 *  sub-types it can land in, the line it came off, and the words for it in a headline. */
interface Kind { id: string; label: string; subTypes: string[]; amount: number | null; line: string; what: string }

function one(input: ReconciliationInput, k: Kind): { suggestions: Suggestion[]; checks: Check[] } {
  const { plan, taxYear, planYear } = input;
  if (k.amount == null || k.amount <= 0) return { suggestions: [], checks: [] };
  const accounts = plan.accounts.filter((a) => k.subTypes.includes(a.subType));
  const ids = new Set(accounts.map((a) => a.id));
  const accountRules = plan.savingsRules.filter((r) => ids.has(r.accountId));
  // The aggregate means "what the plan saves in the plan year", so it keeps the active subset.
  const rules = accountRules.filter((r) => isActiveInYear(r, planYear));
  // A rule that ran through the tax year and stops before the plan year is invisible to that
  // aggregate by design — saving the advisor modelled as ending at retirement. Without this the
  // return's own figure falls through to the create arm and offers to start it again for life.
  const ending = accountRules.filter((r) => isActiveInYear(r, taxYear) && !isActiveInYear(r, planYear));
  // Flat, with no growth: the engine resolves a savings rule as an annual amount, a percent of
  // salary or "contribute the max" (src/engine/savings.ts) and never compounds `annualAmount`.
  const p = sum(rules.map((r) => r.annualAmount));
  const returnFigure = { label: k.label, amount: k.amount, display: money(k.amount), lineRefs: [ref("Sched 1", k.line, k.label, k.amount)] };
  const planFigure = { label: accounts.length ? `Contributions to ${accounts.length === 1 ? accounts[0].name : k.what} in the plan` : `No ${k.what} in the plan`, amount: accounts.length ? p : null, display: accounts.length ? money(p) : "—", year: planYear };
  const netWorth = { label: "Open Net Worth", href: detailsHref(input, "net-worth") };
  const head = `The return deducts ${money(k.amount)} of ${k.what} contributions`;

  if (accounts.length === 0) return { suggestions: [{ id: k.id, section: "savings", kind: "review", status: "open",
    headline: `${head}; the plan has no such account.`,
    meaning: `Add the ${k.what} on Net Worth first; the contribution can then be recorded as a savings rule.`,
    returnFigure, planFigure, delta: makeDelta(k.amount, 0), link: netWorth }], checks: [] };

  if (rules.length === 0 && ending.length > 0) {
    // Named by ACCOUNT, not by rule: a savings rule has no name of its own, and one account can
    // carry several. An ended rule is never shown a dollar figure — the plan really does save
    // nothing into it in the plan year — so the prose carries the reason instead.
    const names = [...new Set(ending.map((r) => accounts.find((a) => a.id === r.accountId)?.name ?? k.what))];
    const label = names.length === 1 ? names[0] : `${names.length} accounts`;
    return { suggestions: [{ id: k.id, section: "savings", kind: "review", status: "open",
      headline: `${head}; the plan's saving into ${label} ran in ${taxYear} but not in ${planYear}.`,
      meaning: `The plan models the contributions as stopping before ${planYear}, so adding a rule here would start them again. Check the end year on Net Worth instead.`,
      returnFigure, planFigure: { label, amount: 0, display: money(0), year: planYear }, delta: makeDelta(k.amount, 0), link: netWorth }], checks: [] };
  }

  // `.create` is a dismissal id of its own: dismissing "add this contribution" must not also
  // suppress "this contribution's amount is off", and those ids are persisted.
  // With several matching accounts the first is the default the advisor overrides; the account is
  // named in the button copy so the write is never anonymous.
  if (rules.length === 0) return { suggestions: [{ id: `${k.id}.create`, section: "savings", kind: "update", status: "open",
    headline: `${head}; the plan saves nothing into ${accounts[0].name}.`,
    meaning: "The deduction on Schedule 1 is the actual contribution. This adds a savings rule for it, ending at retirement.",
    returnFigure, planFigure, delta: makeDelta(k.amount, 0),
    action: { label: `Save ${money(k.amount)} a year`, describe: `Adds a ${money(k.amount)} a year savings rule into ${accounts[0].name}`, amountEditable: true, defaultAmount: k.amount,
      target: { kind: "savings_rule.create", amountField: "annualAmount", input: { accountId: accounts[0].id, annualAmount: k.amount, startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear, endYearRef: "client_retirement" } } } }], checks: [] };

  if (!differs(k.amount, p, ROW)) return { suggestions: [], checks: [{ id: k.id, label: k.label, returnDisplay: money(k.amount), planDisplay: money(p) }] };

  if (rules.length === 1) return { suggestions: [{ id: k.id, section: "savings", kind: "update", status: "open",
    headline: `${head}; the plan saves ${money(p)}.`,
    meaning: "The deduction on Schedule 1 is the actual contribution for the year.",
    returnFigure, planFigure, delta: makeDelta(k.amount, p),
    action: { label: `Set contribution to ${money(k.amount)}`, describe: `Sets the ${k.what} savings rule to ${money(k.amount)} a year`, amountEditable: true, defaultAmount: k.amount,
      target: { kind: "savings_rule.update", ruleId: rules[0].id, patch: { annualAmount: k.amount }, amountField: "annualAmount" } } }], checks: [] };

  return { suggestions: [{ id: k.id, section: "savings", kind: "review", status: "open",
    headline: `${head}; the plan's ${rules.length} rules save ${money(p)}.`,
    meaning: "Which rule is off cannot be told from one line. Adjust them on Net Worth.",
    returnFigure, planFigure, delta: makeDelta(k.amount, p), link: netWorth }], checks: [] };
}

export const savingsRules: Rule = (input) => {
  const d = input.facts.income.adjustmentsDetail;
  // `401k` is deliberately NOT a sub-type here, even though line 16 is where a solo 401(k) lands:
  // there is no solo-401(k) sub-type, so a `401k` account is normally an EMPLOYEE deferral account,
  // and box 1 already excludes those deferrals — they never reach line 16. Including it would
  // compare this line against employee deferrals and offer a wrong write. The cost of leaving it
  // out is that a solo 401(k) modelled on a `401k` account reviews as "no such account", which asks
  // the advisor a question rather than writing a wrong number.
  const a = one(input, { id: "savings.sepSimple", label: "SEP / SIMPLE / solo 401(k) deduction", subTypes: ["sep_ira", "simple_ira"], amount: d?.sepSimpleSolo401k ?? null, line: "16", what: "SEP or SIMPLE IRA" });
  const b = one(input, { id: "savings.hsa", label: "HSA deduction", subTypes: ["hsa"], amount: d?.hsaDeduction ?? null, line: "13", what: "HSA" });
  return { suggestions: [...a.suggestions, ...b.suggestions], checks: [...a.checks, ...b.checks] };
};
