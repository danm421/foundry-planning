import { ROW, detailsHref, differs, isActiveInYear, makeDelta, money, n, ref, rowAmountInYear, sum } from "../compare";
import type { Rule } from "../types";

export const rentalRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const sE = facts.income.scheduleE;
  if (facts.income.scheduleENet == null && sE?.grossRents == null) return { suggestions: [], checks: [] };
  // Depreciation is a non-cash deduction, so a rental that nets to a LOSS on paper can still have
  // produced real money. The plan models cash, so the figure to compare against is net + depreciation.
  const cash = Math.round(n(facts.income.scheduleENet) + n(sE?.depreciation));
  const rows = plan.incomes.filter((i) => isActiveInYear(i, planYear) && (i.linkedPropertyId != null || (i.type === "other" && /rent/i.test(i.name))));
  const properties = plan.accounts.filter((a) => a.subType === "rental_property");
  const p = sum(rows.map((r) => rowAmountInYear(r, taxYear)));
  const id = "income.rental";
  const returnFigure = { label: "Rental cash flow (net + depreciation)", amount: cash, display: money(cash), lineRefs: [ref("Sched 1", "5", "Rental net", facts.income.scheduleENet), ref("Sched E", "18", "Depreciation", sE?.depreciation ?? null)] };
  const planFigure = { label: rows.length === 1 ? rows[0].name : "Rental income in the plan", amount: rows.length ? p : null, display: rows.length ? money(p) : "—", year: planYear };
  const meaningCash = `Depreciation is a paper deduction, so the cash the properties actually produced is the net plus depreciation: ${money(cash)}.`;
  const create = (name: string, linkedPropertyId?: string) => ({ label: `Add rental income of ${money(cash)}`, describe: `Adds "${name}" of ${money(cash)} a year (${taxYear} dollars)`, amountEditable: true, defaultAmount: cash,
    target: { kind: "income.create" as const, amountField: "annualAmount" as const, input: { type: "other", name, owner: "client", annualAmount: cash, growthRate: 0.03, inflationStartYear: taxYear, startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear, ...(linkedPropertyId ? { linkedPropertyId } : {}) } } });
  const netWorth = { label: "Open Net Worth", href: detailsHref(input, "net-worth") };

  if (rows.length === 1) {
    if (!differs(cash, p, ROW)) return { suggestions: [], checks: [{ id, label: "Rental income", returnDisplay: money(cash), planDisplay: money(p) }] };
    return { suggestions: [{ id, section: "income", kind: "update", status: "open", headline: `Rental cash flow on the return is ${money(cash)}; the plan's ${rows[0].name} is ${money(p)}.`, meaning: meaningCash, returnFigure, planFigure, delta: makeDelta(cash, p),
      action: { label: `Set rental income to ${money(cash)}`, describe: `Sets ${rows[0].name} to ${money(cash)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: cash, target: { kind: "income.update", incomeId: rows[0].id, patch: { annualAmount: cash, inflationStartYear: taxYear }, amountField: "annualAmount" } } }], checks: [] };
  }
  if (rows.length >= 2) {
    if (!differs(cash, p, ROW)) return { suggestions: [], checks: [{ id, label: "Rental income", returnDisplay: money(cash), planDisplay: money(p) }] };
    return { suggestions: [{ id, section: "income", kind: "review", status: "open", headline: `Rental cash flow on the return is ${money(cash)}; the plan's ${rows.length} rental rows total ${money(p)}.`, meaning: `${meaningCash} Schedule E is one total across every property, so adjust the rows on Net Worth.`, returnFigure, planFigure, delta: makeDelta(cash, p), link: netWorth }], checks: [] };
  }
  // No rental row at all. Below the floor there is nothing worth adding, and a loss that stays a
  // loss after depreciation is not income the plan is missing.
  if (cash <= 500) return { suggestions: [], checks: [] };
  if (properties.length === 1) return { suggestions: [{ id, section: "income", kind: "update", status: "open", headline: `${properties[0].name} produced ${money(cash)} of cash in ${taxYear}; the plan shows no rental income.`, meaning: meaningCash, returnFigure, planFigure, delta: makeDelta(cash, 0), action: create(`Rental income — ${properties[0].name}`, properties[0].id) }], checks: [] };
  if (properties.length > 1) return { suggestions: [{ id, section: "income", kind: "update", status: "open", headline: `The rentals produced ${money(cash)} of cash in ${taxYear}; the plan shows no rental income.`, meaning: `${meaningCash} The return does not split it by property; link the row to a property on Net Worth afterwards.`, returnFigure, planFigure, delta: makeDelta(cash, 0), action: create(`Rental income (from ${taxYear} return)`) }], checks: [] };
  return { suggestions: [{ id, section: "income", kind: "review", status: "open", headline: `The return shows ${money(cash)} of rental cash flow; the plan has no rental property.`, meaning: `${meaningCash} Add the property on Net Worth first, then its income.`, returnFigure, planFigure, delta: makeDelta(cash, 0), link: netWorth }], checks: [] };
};
