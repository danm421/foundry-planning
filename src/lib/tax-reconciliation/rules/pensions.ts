import { ROW, detailsHref, differs, hasSpouse, isActiveInYear, makeDelta, money, ref, rowAmountInYear, sum } from "../compare";
import type { Rule } from "../types";

export const pensionRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const gross = facts.income.pensionsGross;
  // No plan-only arm: line 5a is blank in any year without a distribution, so a pension the plan
  // carries and the return does not report is not evidence of anything.
  if (gross == null || gross <= 1_000) return { suggestions: [], checks: [] };
  const deferredRows = plan.incomes.filter((i) => i.type === "deferred");
  // The aggregate means "what the plan pays in the plan year", so it keeps the active subset.
  const rows = deferredRows.filter((i) => isActiveInYear(i, planYear));
  // Two shapes are invisible to that aggregate by design, and both would otherwise leave the plan
  // looking short against line 5a with the create arm offering to add a pension. The predicates are
  // ASYMMETRIC on purpose:
  //
  //  - ENDING blocks the create only when the row was active in the TAX year — a pension the
  //    advisor modelled as stopping. A row that ended in 2015 never pays again, so a new one cannot
  //    double up and the advisor should still be offered it.
  //  - FUTURE blocks whenever the row starts after the plan year, whatever it did in the tax year,
  //    because the overlap a create would make is real: a 2030-2060 row plus a new 2026-2060 row
  //    pays the pension TWICE from 2030 on.
  const ending = deferredRows.filter((i) => !isActiveInYear(i, planYear) && isActiveInYear(i, taxYear));
  const future = deferredRows.filter((i) => i.startYear > planYear);
  const p = sum(rows.map((r) => rowAmountInYear(r, taxYear)));
  const returnFigure = { label: "Pensions and annuities", amount: gross, display: money(gross), lineRefs: [ref("1040", "5a", "Pensions and annuities", gross)] };
  const planFigure = { label: rows.length === 1 ? rows[0].name : "Pensions in the plan", amount: p, display: money(p), year: planYear };
  const id = "income.pensions";
  const outflows = { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") };
  if (rows.length === 0 && ending.length > 0) {
    const label = ending.length === 1 ? ending[0].name : `${ending.length} pensions`;
    return { suggestions: [{ id, section: "income", kind: "review", status: "open",
      headline: `The return shows ${money(gross)} of pension income; the plan's ${label} ran in ${taxYear} but not in ${planYear}.`,
      meaning: `The plan models the pension as stopping before ${planYear}, so adding one here would restart it for life. Check the end year on Inflows & Outflows instead.`,
      returnFigure, planFigure: { label, amount: 0, display: money(0), year: planYear }, delta: makeDelta(gross, 0), link: outflows }], checks: [] };
  }
  if (rows.length === 0 && future.length > 0) {
    const label = future.length === 1 ? future[0].name : `${future.length} pensions`;
    const starts = Math.min(...future.map((i) => i.startYear));
    return { suggestions: [{ id, section: "income", kind: "review", status: "open",
      headline: `The return shows ${money(gross)} of pension income; the plan's ${label} does not start until ${starts}.`,
      meaning: `Adding one here would run alongside it and pay the pension twice from ${starts} on. Move the start year back on Inflows & Outflows instead.`,
      returnFigure, planFigure: { label, amount: 0, display: money(0), year: planYear }, delta: makeDelta(gross, 0), link: outflows }], checks: [] };
  }
  if (rows.length > 0 && !differs(gross, p, ROW)) return { suggestions: [], checks: [{ id, label: "Pensions", returnDisplay: money(gross), planDisplay: money(p) }] };
  if (rows.length === 0) return { suggestions: [{ id, section: "income", kind: "update", status: "open",
    headline: `The return shows ${money(gross)} of pension income; the plan has none.`,
    meaning: "A pension on line 5a is a stream the plan should carry for life. This adds it flat (no growth); set a cost-of-living adjustment on the row if the pension has one.",
    returnFigure, planFigure, delta: makeDelta(gross, 0),
    // Line 5a is a household total on a joint return, so it does not say whose pension this is —
    // and ownership drives survivor modelling, so a spouse's pension booked to the client stops
    // paying at the wrong death. `owner: "client"` below is only the default the advisor overrides.
    action: { label: `Add pension of ${money(gross)}`, describe: `Adds "Pension (from ${taxYear} return)" of ${money(gross)} a year`, amountEditable: true, defaultAmount: gross,
      ownerChoices: hasSpouse(plan) ? ["client", "spouse"] : undefined,
      target: { kind: "income.create", amountField: "annualAmount", ownerField: "owner", input: { type: "deferred", name: `Pension (from ${taxYear} return)`, owner: "client", annualAmount: gross, growthRate: 0, inflationStartYear: taxYear, startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear } } } }], checks: [] };
  if (rows.length === 1) return { suggestions: [{ id, section: "income", kind: "update", status: "open",
    headline: `The return shows ${money(gross)} of pension income; the plan's ${rows[0].name} is ${money(p)} in ${taxYear} dollars.`,
    meaning: "The 1099-R figure is the actual payment. Setting the row to it keeps its growth assumption.",
    returnFigure, planFigure, delta: makeDelta(gross, p),
    action: { label: `Set pension to ${money(gross)}`, describe: `Sets ${rows[0].name} to ${money(gross)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: gross,
      target: { kind: "income.update", incomeId: rows[0].id, patch: { annualAmount: gross, inflationStartYear: taxYear }, amountField: "annualAmount" } } }], checks: [] };
  return { suggestions: [{ id, section: "income", kind: "review", status: "open",
    headline: `The return shows ${money(gross)} of pension income; the plan's ${rows.length} pensions total ${money(p)}.`,
    meaning: "Line 5a is one total, so the return cannot say which pension is off. Adjust them on Inflows & Outflows.",
    returnFigure, planFigure, delta: makeDelta(gross, p), link: outflows }], checks: [] };
};
