import { ROW, detailsHref, differs, hasSpouse, isActiveInYear, makeDelta, money, ref, rowAmountInYear, sum } from "../compare";
import type { Rule } from "../types";

export const pensionRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear } = input;
  const gross = facts.income.pensionsGross;
  // No plan-only arm: line 5a is blank in any year without a distribution, so a pension the plan
  // carries and the return does not report is not evidence of anything.
  if (gross == null || gross <= 1_000) return { suggestions: [], checks: [] };
  const rows = plan.incomes.filter((i) => i.type === "deferred" && isActiveInYear(i, planYear));
  const p = sum(rows.map((r) => rowAmountInYear(r, taxYear)));
  const returnFigure = { label: "Pensions and annuities", amount: gross, display: money(gross), lineRefs: [ref("1040", "5a", "Pensions and annuities", gross)] };
  const planFigure = { label: rows.length === 1 ? rows[0].name : "Pensions in the plan", amount: p, display: money(p), year: planYear };
  const id = "income.pensions";
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
    returnFigure, planFigure, delta: makeDelta(gross, p), link: { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") } }], checks: [] };
};
