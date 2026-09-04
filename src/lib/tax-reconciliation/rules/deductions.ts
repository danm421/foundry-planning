import { ROW, detailsHref, differs, isActiveInYear, makeDelta, money, n, planToTaxYear, ref, rowAmountInYear, sum } from "../compare";
import type { Check, Rule, Suggestion } from "../types";

export const deductionRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear, engineYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  const a = facts.deductions.scheduleA;
  if (!a) return { suggestions, checks };

  // Both boxes null means Schedule A said nothing about giving, which is not the same as zero.
  const charity = a.charitableCash == null && a.charitableNonCash == null ? null : n(a.charitableCash) + n(a.charitableNonCash);
  if (charity != null && charity > 500) {
    const charitableRows = plan.deductions.filter((d) => d.type === "charitable");
    // The aggregate means "what the plan gives in the plan year", so it keeps the active subset.
    const rows = charitableRows.filter((d) => isActiveInYear(d, planYear));
    // A pledge that ran through the tax year and finishes before the plan year is invisible to that
    // aggregate by design. Without this the return's own figure falls through to the create arm and
    // offers to add the giving back for the life of the plan.
    const ending = charitableRows.filter((d) => isActiveInYear(d, taxYear) && !isActiveInYear(d, planYear));
    // `client_deductions` carries no inflation start year, and the engine grows a deduction row
    // from its own `startYear` (src/lib/tax/derive-deductions.ts), so state the plan figure the
    // same way rather than from an inflation start the column does not have.
    const p = sum(rows.map((d) => rowAmountInYear({ ...d, inflationStartYear: null }, taxYear)));
    const id = "deductions.charitable";
    const returnFigure = { label: "Charitable gifts", amount: charity, display: money(charity), lineRefs: [ref("Sched A", "11–12", "Gifts to charity", charity)] };
    const planFigure = { label: rows.length === 1 ? (rows[0].name ?? "Charitable") : "Charitable deductions in the plan", amount: rows.length ? p : null, display: rows.length ? money(p) : "—", year: planYear };
    const deductionsLink = { label: "Open Deductions", href: detailsHref(input, "deductions") };
    if (rows.length === 0 && ending.length > 0) {
      // An ended row is never shown a dollar figure — the plan gives nothing in the plan year — so
      // the prose names the row and says why instead.
      const label = ending.length === 1 ? (ending[0].name ?? "charitable giving") : `${ending.length} charitable rows`;
      suggestions.push({ id, section: "deductions", kind: "review", status: "open",
        headline: `The return deducts ${money(charity)} of gifts to charity; the plan's ${label} ran in ${taxYear} but not in ${planYear}.`,
        meaning: `The plan models the giving as finishing before ${planYear}, so adding a row here would start it again for the life of the plan. Check the end year on Deductions instead.`,
        returnFigure, planFigure: { label, amount: 0, display: money(0), year: planYear }, delta: makeDelta(charity, 0), link: deductionsLink });
    }
    // `.create` is a dismissal id of its own: dismissing "add this giving" must not also suppress
    // "this giving's amount is off", and those ids are persisted.
    else if (rows.length === 0) suggestions.push({ id: `${id}.create`, section: "deductions", kind: "update", status: "open",
      headline: `The return deducts ${money(charity)} of gifts to charity; the plan has none.`,
      meaning: "Giving that repeats every year belongs in the plan as a deduction so itemizing is modeled correctly. Added flat, jointly, for the whole plan.",
      returnFigure, planFigure, delta: makeDelta(charity, 0),
      action: { label: `Add giving of ${money(charity)}`, describe: `Adds a charitable deduction of ${money(charity)} a year`, amountEditable: true, defaultAmount: charity,
        target: { kind: "deduction.create", amountField: "annualAmount", input: { type: "charitable", name: `Charitable giving (from ${taxYear} return)`, owner: "joint", annualAmount: charity, growthRate: 0, startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear } } } });
    else if (!differs(charity, p, ROW)) checks.push({ id, label: "Charitable gifts", returnDisplay: money(charity), planDisplay: money(p) });
    else if (rows.length === 1) suggestions.push({ id, section: "deductions", kind: "update", status: "open",
      headline: `The return deducts ${money(charity)} of gifts to charity; the plan carries ${money(p)}.`,
      meaning: "Schedule A is the actual giving for the year.",
      returnFigure, planFigure, delta: makeDelta(charity, p),
      action: { label: `Set giving to ${money(charity)}`, describe: `Sets ${rows[0].name ?? "the charitable deduction"} to ${money(charity)} a year`, amountEditable: true, defaultAmount: charity,
        target: { kind: "deduction.update", deductionId: rows[0].id, patch: { annualAmount: charity }, amountField: "annualAmount" } } });
    else suggestions.push({ id, section: "deductions", kind: "review", status: "open",
      headline: `The return deducts ${money(charity)} of gifts to charity; the plan's ${rows.length} rows total ${money(p)}.`,
      meaning: "Schedule A is one total. Adjust the rows on Deductions.",
      returnFigure, planFigure, delta: makeDelta(charity, p), link: deductionsLink });
  }

  // SALT and mortgage interest are engine-level: neither is a plan row an advisor edits directly,
  // so both arms review or report rather than offering a write.
  if (engineYear?.deductionBreakdown && a.saltPaid != null) {
    const p = planToTaxYear(input, engineYear.deductionBreakdown.belowLine.stateIncomeTax + engineYear.deductionBreakdown.belowLine.propertyTaxes);
    const id = "deductions.salt";
    const fig = { returnFigure: { label: "State and local taxes paid", amount: a.saltPaid, display: money(a.saltPaid), lineRefs: [ref("Sched A", "5d", "SALT paid (before the cap)", a.saltPaid)] }, planFigure: { label: "State income + property tax in the plan", amount: p, display: money(p), year: planYear } };
    if (a.saltPaid > 2 * p && a.saltPaid - p > 2_000) suggestions.push({ id, section: "deductions", kind: "review", status: "open",
      headline: `The household paid ${money(a.saltPaid)} of state and local tax; the plan models ${money(p)}.`,
      meaning: "Property tax comes from the real estate on Net Worth and state income tax from the residence state. A gap this size usually means a property is missing its annual tax, or the state is not set.",
      ...fig, delta: makeDelta(a.saltPaid, p), link: { label: "Open Net Worth", href: detailsHref(input, "net-worth") } });
    else checks.push({ id, label: "State and local taxes", returnDisplay: money(a.saltPaid), planDisplay: money(p) });
  }

  if (engineYear && a.mortgageInterest != null && a.mortgageInterest > 1_000) {
    const p = planToTaxYear(input, sum(Object.values(engineYear.expenses.interestByLiability)));
    const id = "deductions.mortgageInterest";
    const fig = { returnFigure: { label: "Mortgage interest", amount: a.mortgageInterest, display: money(a.mortgageInterest), lineRefs: [ref("Sched A", "8a", "Home mortgage interest", a.mortgageInterest)] }, planFigure: { label: "Loan interest in the plan", amount: p, display: money(p), year: planYear } };
    if (p < 0.5 * a.mortgageInterest) suggestions.push({ id, section: "deductions", kind: "review", status: "open",
      headline: `The return deducts ${money(a.mortgageInterest)} of mortgage interest; the plan's loans pay ${money(p)}.`,
      meaning: "Interest in the plan comes from the liabilities on Net Worth. Either the mortgage is missing, or its balance and rate are low.",
      ...fig, delta: makeDelta(a.mortgageInterest, p), link: { label: "Open Net Worth", href: detailsHref(input, "net-worth") } });
    else checks.push({ id, label: "Mortgage interest", returnDisplay: money(a.mortgageInterest), planDisplay: money(p) });
  }

  return { suggestions, checks };
};
