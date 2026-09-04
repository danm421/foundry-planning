import { ROW, detailsHref, differs, editableAmount, hasSpouse, isActiveInYear, makeDelta, money, n, ref, rowAmountInYear, sum } from "../compare";
import type { OwnerChoice, PlanIncome, Rule } from "../types";

export const rentalRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const sE = facts.income.scheduleE;
  // Gated on the NET alone. `grossRents` reaches neither the cash figure nor the line refs, so
  // letting it open the rule only widens the inputs that proceed: with the net missing, `n(null)`
  // would coerce the unknown to 0 and a plan rental row would be offered a one-click write to $0
  // under "Rental cash flow on the return is $0" — defeating the null guard `differs` already
  // carries for exactly this case.
  if (facts.income.scheduleENet == null) return { suggestions: [], checks: [] };
  // Depreciation is a non-cash deduction, so a rental that nets to a LOSS on paper can still have
  // produced real money. The plan models cash, so the figure to compare against is net + depreciation.
  const cash = Math.round(facts.income.scheduleENet + n(sE?.depreciation));
  const isRental = (i: PlanIncome) => i.linkedPropertyId != null || (i.type === "other" && /rent/i.test(i.name));
  const rentalRows = plan.incomes.filter(isRental);
  // The aggregate below means "what the plan pays in the plan year", so it keeps the active subset.
  const rows = rentalRows.filter((i) => isActiveInYear(i, planYear));
  // Two shapes are invisible to that aggregate by design, and neither is a missing row. Without
  // them the return's own figure falls through to the create arm. The predicates are ASYMMETRIC on
  // purpose:
  //
  //  - ENDING blocks the create only when the row was active in the TAX year — a rental the advisor
  //    modelled as sold. A row that ended in 2015 never pays again, so a new one cannot double up
  //    and the advisor should still be offered it.
  //  - FUTURE blocks whenever the row starts after the plan year, whatever it did in the tax year,
  //    because the overlap a create would make is real: a 2030-2060 row plus a new 2026-2060 row
  //    pays the rent TWICE from 2030 on.
  const ending = rentalRows.filter((i) => !isActiveInYear(i, planYear) && isActiveInYear(i, taxYear));
  const future = rentalRows.filter((i) => i.startYear > planYear);
  const properties = plan.accounts.filter((a) => a.subType === "rental_property");
  const p = sum(rows.map((r) => rowAmountInYear(r, taxYear)));
  const id = "income.rental";
  const returnFigure = { label: "Rental cash flow (net + depreciation)", amount: cash, display: money(cash), lineRefs: [ref("Sched 1", "5", "Rental net", facts.income.scheduleENet), ref("Sched E", "18", "Depreciation", sE?.depreciation ?? null)] };
  const planFigure = { label: rows.length === 1 ? rows[0].name : "Rental income in the plan", amount: rows.length ? p : null, display: rows.length ? money(p) : "—", year: planYear };
  const meaningCash = `Depreciation is a paper deduction, so the cash the properties actually produced is the net plus depreciation: ${money(cash)}.`;
  // Schedule E carries no taxpayer/spouse indicator, so the return cannot say whose rental it is —
  // and ownership drives survivor modelling. `owner: "client"` is only the default to override.
  const spouse = hasSpouse(plan);
  const ownerChoices: OwnerChoice[] | undefined = spouse ? ["client", "spouse"] : undefined;
  const ownerNote = spouse ? " The return does not say whose it is; pick the owner first." : "";
  const create = (name: string, linkedPropertyId?: string) => ({ label: `Add rental income of ${money(cash)}`, describe: `Adds "${name}" of ${money(cash)} a year (${taxYear} dollars)`, amountEditable: true, defaultAmount: cash, ownerChoices,
    target: { kind: "income.create" as const, amountField: "annualAmount" as const, ownerField: "owner" as const, input: { type: "other", name, owner: "client", annualAmount: cash, growthRate: 0.03, inflationStartYear: taxYear, startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear, ...(linkedPropertyId ? { linkedPropertyId } : {}) } } });
  const netWorth = { label: "Open Net Worth", href: detailsHref(input, "net-worth") };

  if (rows.length === 1) {
    if (!differs(cash, p, ROW)) return { suggestions: [], checks: [{ id, label: "Rental income", returnDisplay: money(cash), planDisplay: money(p) }] };
    return { suggestions: [{ id, section: "income", kind: "update", status: "open", headline: `Rental cash flow on the return is ${money(cash)}; the plan's ${rows[0].name} is ${money(p)}.`, meaning: meaningCash, returnFigure, planFigure, delta: makeDelta(cash, p),
      // Not editable when the cash figure is still a loss: the `cash <= 500` floor below
      // never sees this arm, and the card's unsigned box would apply the positive twin.
      action: { label: `Set rental income to ${money(cash)}`, describe: `Sets ${rows[0].name} to ${money(cash)} (${taxYear} dollars)`, amountEditable: editableAmount(cash), defaultAmount: cash, target: { kind: "income.update", incomeId: rows[0].id, patch: { annualAmount: cash, inflationStartYear: taxYear }, amountField: "annualAmount" } } }], checks: [] };
  }
  if (rows.length >= 2) {
    if (!differs(cash, p, ROW)) return { suggestions: [], checks: [{ id, label: "Rental income", returnDisplay: money(cash), planDisplay: money(p) }] };
    return { suggestions: [{ id, section: "income", kind: "review", status: "open", headline: `Rental cash flow on the return is ${money(cash)}; the plan's ${rows.length} rental rows total ${money(p)}.`, meaning: `${meaningCash} Schedule E is one total across every property, so adjust the rows on Net Worth.`, returnFigure, planFigure, delta: makeDelta(cash, p), link: netWorth }], checks: [] };
  }
  // No rental row runs in the plan year. Below the floor there is nothing worth adding, and a loss
  // that stays a loss after depreciation is not income the plan is missing.
  if (cash <= 500) return { suggestions: [], checks: [] };
  if (ending.length > 0) {
    const label = ending.length === 1 ? ending[0].name : `${ending.length} rental rows`;
    return { suggestions: [{ id, section: "income", kind: "review", status: "open", headline: `The return shows ${money(cash)} of rental cash flow; the plan's ${label} ran in ${taxYear} but not in ${planYear}.`,
      meaning: `${meaningCash} The plan models the rental as stopping before ${planYear}, so adding a row here would restart it for the life of the plan. Check the end year on Net Worth instead.`,
      returnFigure, planFigure: { label, amount: 0, display: money(0), year: planYear }, delta: makeDelta(cash, 0), link: netWorth }], checks: [] };
  }
  if (future.length > 0) {
    const label = future.length === 1 ? future[0].name : `${future.length} rental rows`;
    const starts = Math.min(...future.map((i) => i.startYear));
    return { suggestions: [{ id, section: "income", kind: "review", status: "open", headline: `The return shows ${money(cash)} of rental cash flow; the plan's ${label} does not start until ${starts}.`,
      meaning: `${meaningCash} Adding a row here would run alongside it and pay the rent twice from ${starts} on. Move the start year back on Net Worth instead.`,
      returnFigure, planFigure: { label, amount: 0, display: money(0), year: planYear }, delta: makeDelta(cash, 0), link: netWorth }], checks: [] };
  }
  // `.create` is a dismissal id of its own: dismissing "add rental income" must not also suppress
  // "the rental amount is off", and those ids are persisted.
  if (properties.length === 1) return { suggestions: [{ id: `${id}.create`, section: "income", kind: "update", status: "open", headline: `${properties[0].name} produced ${money(cash)} of cash in ${taxYear}; the plan shows no rental income.`, meaning: `${meaningCash}${ownerNote}`, returnFigure, planFigure, delta: makeDelta(cash, 0), action: create(`Rental income — ${properties[0].name}`, properties[0].id) }], checks: [] };
  if (properties.length > 1) return { suggestions: [{ id: `${id}.create`, section: "income", kind: "update", status: "open", headline: `The rentals produced ${money(cash)} of cash in ${taxYear}; the plan shows no rental income.`, meaning: `${meaningCash} The return does not split it by property; link the row to a property on Net Worth afterwards.${ownerNote}`, returnFigure, planFigure, delta: makeDelta(cash, 0), action: create(`Rental income (from ${taxYear} return)`) }], checks: [] };
  return { suggestions: [{ id, section: "income", kind: "review", status: "open", headline: `The return shows ${money(cash)} of rental cash flow; the plan has no rental property.`, meaning: `${meaningCash} Add the property on Net Worth first, then its income.`, returnFigure, planFigure, delta: makeDelta(cash, 0), link: netWorth }], checks: [] };
};
