import { ROW, ageAtYearEnd, deflate, detailsHref, differs, isActiveInYear, makeDelta, money, n, ref, rowAmountInYear, sum } from "../compare";
import type { Check, PlanIncome, Rule, Suggestion } from "../types";

export const socialSecurityRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear, engineYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  const rows = plan.incomes.filter((i) => i.type === "social_security");
  const paid = (r: PlanIncome): number => engineYear ? n(engineYear.income.bySource[r.id]) : (isActiveInYear(r, planYear) ? rowAmountInYear(r, planYear) : 0);
  const active = rows.filter((r) => engineYear ? paid(r) > 0 : isActiveInYear(r, planYear) && (r.annualAmount > 0 || n(r.piaMonthly) > 0));
  // Every figure on this card is stated in TAX-year dollars, and the row's own growth rate is what
  // moved it — not the plan's inflation rate, which for a 2% benefit in a 3% plan is a $400 lie.
  const inTaxYear = (r: PlanIncome) => deflate(paid(r), r.growthRate, planYear - taxYear);
  const gross = facts.income.ssBenefitsGross;
  const returnFigure = { label: "Social Security received", amount: gross, display: money(gross), lineRefs: [ref("1040", "6a", "Social Security benefits", gross)] };
  const dobFor = (owner: "client" | "spouse") => (owner === "spouse" ? plan.client.spouseDob : plan.client.dateOfBirth);

  if (gross != null && gross > 500) {
    if (active.length === 0) {
      const planFigure = { label: "Social Security in the plan", amount: 0, display: money(0), year: planYear };
      if (rows.length === 0) {
        suggestions.push({ id: "income.socialSecurity", section: "income", kind: "review", status: "open",
          headline: "Social Security is on the return but the plan has no Social Security row.",
          meaning: `The household received ${money(gross)} in ${taxYear}. Add a Social Security income on Inflows & Outflows and enter the benefit.`,
          returnFigure, planFigure, delta: makeDelta(gross, 0), link: { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") } });
      } else {
        // The rows exist but pay nothing, so this is the un-claimed seed: benefits have started in
        // real life and the plan has not been told. `apply.ts` sets the amount from the owner
        // choice, which is why each row carries its patch already built and no annualAmount.
        // startYear takes the EARLIER of the row's start and the plan's — a row that does not begin
        // until, say, 2030 would otherwise still pay nothing after the claim was applied.
        const claimRows = rows.filter((r) => r.owner === "client" || r.owner === "spouse").map((r) => ({
          owner: r.owner as "client" | "spouse", incomeId: r.id,
          patch: { ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge: ageAtYearEnd(dobFor(r.owner as "client" | "spouse"), taxYear), startYear: Math.min(r.startYear, plan.planSettings.planStartYear), inflationStartYear: taxYear },
        }));
        const both = claimRows.length >= 2;
        suggestions.push({ id: "income.socialSecurity", section: "income", kind: "update", status: "open",
          headline: "Social Security is on the return but not in the plan yet.",
          meaning: `The household received ${money(gross)} in ${taxYear}, so benefits have already started. This records the benefit as an annual amount already being claimed${both ? "; the return does not say whose, so choose who receives it" : ""}.`,
          returnFigure, planFigure, delta: makeDelta(gross, 0),
          action: { label: `Record ${money(gross)} of Social Security`, describe: `Marks Social Security as claimed at ${money(gross)} a year (${taxYear} dollars)`, amountEditable: true, defaultAmount: gross,
            ownerChoices: both ? ["client", "spouse", "split"] : undefined,
            target: { kind: "income.socialSecurity.claim", rows: claimRows, amount: gross } } });
      }
    } else if (active.length === 1) {
      const row = active[0];
      const p = inTaxYear(row);
      const planFigure = { label: row.name, amount: p, display: money(p), year: planYear };
      if (differs(gross, p, ROW)) {
        suggestions.push({ id: "income.socialSecurity.amount", section: "income", kind: "update", status: "open",
          headline: `The return shows ${money(gross)} of Social Security; the plan pays ${money(p)} in ${taxYear} dollars.`,
          meaning: "The benefit on the return is the actual award. Setting the row to it switches the row to a stated annual amount and grows it from the tax year.",
          returnFigure, planFigure, delta: makeDelta(gross, p),
          action: { label: `Set benefit to ${money(gross)}`, describe: `Sets ${row.name} to ${money(gross)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: gross,
            target: { kind: "income.update", incomeId: row.id, patch: { ssBenefitMode: "manual_amount", annualAmount: gross, inflationStartYear: taxYear }, amountField: "annualAmount" } } });
      } else checks.push({ id: "income.socialSecurity", label: "Social Security", returnDisplay: money(gross), planDisplay: money(p) });
    } else {
      const p = sum(active.map(inTaxYear));
      const planFigure = { label: "Social Security (both)", amount: p, display: money(p), year: planYear };
      if (differs(gross, p, ROW)) {
        suggestions.push({ id: "income.socialSecurity.split", section: "income", kind: "review", status: "open",
          headline: `The return shows ${money(gross)} of Social Security; the plan's two benefits total ${money(p)}.`,
          meaning: "Line 6a is the household total, so which benefit is off cannot be told from the return. Adjust the rows on Inflows & Outflows.",
          returnFigure, planFigure, delta: makeDelta(gross, p), link: { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") } });
      } else checks.push({ id: "income.socialSecurity", label: "Social Security", returnDisplay: money(gross), planDisplay: money(p) });
    }
  } else if (active.length > 0) {
    const p = sum(active.map(inTaxYear));
    suggestions.push({ id: "income.socialSecurity.planOnly", section: "income", kind: "info", status: "open",
      headline: `The plan pays ${money(p)} of Social Security in ${planYear}; the ${taxYear} return shows none.`,
      meaning: "Fine if benefits start this year. If they have not been claimed, check the claiming age on the row.",
      returnFigure, planFigure: { label: "Social Security in the plan", amount: p, display: money(p), year: planYear }, delta: makeDelta(0, p) });
  }

  return { suggestions, checks };
};
