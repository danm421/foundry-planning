import { ROW, W2, detailsHref, differs, hasSpouse, isActiveInYear, makeDelta, money, n, namesMatch, planToTaxYear, ref, rowAmountInYear, sum } from "../compare";
import type { Check, PlanIncome, Rule, Suggestion } from "../types";

const DEFERRAL_SUBTYPES = new Set(["401k", "403b"]);

export const wageRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear, w2s } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  // Match W-2s against EVERY salary row, ended ones included: the retirement or job-change year is
  // the likeliest year to be reconciling a return at all, and a row that ends in the tax year would
  // otherwise be invisible to the matcher — its own W-2 would fall through to the create arm and
  // offer to re-employ the client at full salary for the life of the plan.
  const salaryRows = plan.incomes.filter((i) => i.type === "salary");
  // The aggregates below mean "what the plan pays in the plan year", so they keep the active subset.
  const rows = salaryRows.filter((i) => isActiveInYear(i, planYear));
  const deferralAccountIds = new Set(plan.accounts.filter((a) => DEFERRAL_SUBTYPES.has(a.subType)).map((a) => a.id));
  const hasDeferralRule = plan.savingsRules.some((r) => deferralAccountIds.has(r.accountId));
  const deferralNote = hasDeferralRule
    ? " Box 1 excludes pre-tax 401(k)/403(b) deferrals, so a plan salary that is higher by about the deferral is not a gap."
    : "";
  const spouse = hasSpouse(plan);
  const planFig = (row: PlanIncome) => ({ label: row.name, amount: rowAmountInYear(row, taxYear), display: money(rowAmountInYear(row, taxYear)), year: planYear });
  const createInput = (name: string, amount: number) => ({
    type: "salary", name, owner: "client", annualAmount: amount, growthRate: 0.03, inflationStartYear: taxYear,
    startYear: plan.planSettings.planStartYear, endYear: plan.planSettings.planEndYear, endYearRef: "client_retirement",
  });

  const claimed = new Set<string>();
  w2s.forEach((w, i) => {
    if (w.wages == null) return;
    const wages = w.wages;
    const id = `income.wages.w2.${i}`;
    const employer = w.employer ?? `W-2 #${i + 1}`;
    const returnFigure = { label: `${employer} · box 1`, amount: wages, display: money(wages), lineRefs: [ref("W-2", "Box 1", `${employer} wages`, wages)] };
    const match = salaryRows.find((r) => !claimed.has(r.id) && namesMatch(w.employer, r.name));
    if (match) {
      claimed.add(match.id);
      if (!isActiveInYear(match, planYear)) {
        // The row is real and it matched; it just ends before the plan year — a job the client has
        // already left. There is nothing to write, so record that the W-2 was accounted for and say
        // why the plan carries no salary for it. Claiming the row is safe: the unmatchedRow loop
        // below only walks active rows.
        checks.push({ id, label: `Wages · ${employer}`, returnDisplay: money(wages), planDisplay: `Ends in ${match.endYear}, before the ${planYear} plan year` });
        return;
      }
      const p = rowAmountInYear(match, taxYear);
      if (differs(wages, p, W2)) {
        suggestions.push({
          id, section: "income", kind: "update", status: "open",
          headline: `${employer} paid ${money(wages)} in ${taxYear}; the plan's ${match.name} is ${money(p)} in ${taxYear} dollars.`,
          meaning: `The W-2 is the actual figure. Setting the row to it keeps the plan's growth assumptions but starts them from what was really earned.${deferralNote}`,
          returnFigure, planFigure: planFig(match), delta: makeDelta(wages, p),
          action: { label: `Set salary to ${money(wages)}`, describe: `Sets ${match.name} to ${money(wages)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: wages,
            target: { kind: "income.update", incomeId: match.id, patch: { annualAmount: wages, inflationStartYear: taxYear }, amountField: "annualAmount" } },
        });
      } else checks.push({ id, label: `Wages · ${employer}`, returnDisplay: money(wages), planDisplay: money(p) });
      return;
    }
    if (wages > 1_000) {
      suggestions.push({
        id: `${id}.create`, section: "income", kind: "update", status: "open",
        headline: `${employer} is on the return but not in the plan.`,
        meaning: `A W-2 with no matching salary row means the plan is missing ${money(wages)} of earned income a year. Add it as a salary that ends at retirement.${spouse ? " The W-2 does not say whose it is; pick the owner first." : ""}`,
        returnFigure, planFigure: { label: "No matching salary", amount: null, display: "—", year: planYear }, delta: makeDelta(wages, null),
        action: { label: `Add salary of ${money(wages)}`, describe: `Adds a salary "${employer}" of ${money(wages)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: wages,
          ownerChoices: spouse ? ["client", "spouse"] : undefined,
          target: { kind: "income.create", input: createInput(employer, wages), amountField: "annualAmount", ownerField: "owner" } },
      });
    }
  });

  if (w2s.length > 0 && facts.income.wages != null) {
    const planTotal = sum(rows.map((r) => rowAmountInYear(r, taxYear)));
    if (facts.income.wages < planTotal && differs(facts.income.wages, planTotal, W2)) {
      for (const row of rows.filter((r) => !claimed.has(r.id))) {
        suggestions.push({
          id: `income.wages.unmatchedRow.${row.id}`, section: "income", kind: "review", status: "open",
          headline: `${row.name} is in the plan, but no W-2 on the return matches it.`,
          meaning: `Total wages on the return (${money(facts.income.wages)}) are below the plan's salaries (${money(planTotal)}). This job may have ended, or its W-2 was not uploaded.`,
          returnFigure: { label: "Wages (all W-2s)", amount: facts.income.wages, display: money(facts.income.wages), lineRefs: [ref("1040", "1a", "Wages", facts.income.wages)] },
          planFigure: planFig(row), delta: makeDelta(facts.income.wages, planTotal),
          link: { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") },
        });
      }
    }
  }

  if (w2s.length === 0 && facts.income.wages != null) {
    const wages = facts.income.wages;
    const deferrals = input.engineYear ? planToTaxYear(input, n(input.engineYear.deductionBreakdown?.aboveLine.retirementContributions)) : 0;
    const gross = sum(rows.map((r) => rowAmountInYear(r, taxYear)));
    const p = gross - deferrals;
    const returnFigure = { label: "Wages", amount: wages, display: money(wages), lineRefs: [ref("1040", "1a", "Wages", wages)] };
    const planFigure = { label: rows.length === 1 ? rows[0].name : "Salaries after pre-tax deferrals", amount: p, display: money(p), year: planYear };
    const id = "income.wages.total";
    if (!differs(wages, p, ROW)) {
      checks.push({ id, label: "Wages", returnDisplay: money(wages), planDisplay: money(p) });
    } else if (rows.length === 0) {
      suggestions.push({ id, section: "income", kind: "update", status: "open",
        headline: `The return shows ${money(wages)} of wages; the plan has no salary.`,
        meaning: "Without W-2s the return cannot say which employer or whose. Add one salary row now and rename it, or upload the W-2s on Tax Analysis for a per-employer comparison.",
        returnFigure, planFigure, delta: makeDelta(wages, 0),
        action: { label: `Add wages of ${money(wages)}`, describe: `Adds a salary "Wages (from ${taxYear} return)" of ${money(wages)}`, amountEditable: true, defaultAmount: wages, ownerChoices: spouse ? ["client", "spouse"] : undefined,
          target: { kind: "income.create", input: createInput(`Wages (from ${taxYear} return)`, wages), amountField: "annualAmount", ownerField: "owner" } } });
    } else if (rows.length === 1) {
      const amount = Math.round(wages + deferrals);
      suggestions.push({ id, section: "income", kind: "update", status: "open",
        headline: `Wages on the return are ${money(wages)}; the plan's ${rows[0].name} works out to ${money(p)} after deferrals.`,
        meaning: deferrals > 0 ? `The plan defers ${money(deferrals)} pre-tax, which box 1 leaves out; the row is set to the return's wages plus that deferral so it stays a gross salary.` : "The row is set to the return's figure in tax-year dollars.",
        returnFigure, planFigure, delta: makeDelta(wages, p),
        action: { label: `Set salary to ${money(amount)}`, describe: `Sets ${rows[0].name} to ${money(amount)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: amount,
          target: { kind: "income.update", incomeId: rows[0].id, patch: { annualAmount: amount, inflationStartYear: taxYear }, amountField: "annualAmount" } } });
    } else {
      suggestions.push({ id, section: "income", kind: "review", status: "open",
        headline: `Wages on the return are ${money(wages)}; the plan's ${rows.length} salaries total ${money(p)}.`,
        meaning: "Which salary is off cannot be told from line 1a alone. Upload the W-2s on Tax Analysis, or adjust the rows on Inflows & Outflows.",
        returnFigure, planFigure, delta: makeDelta(wages, p), link: { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") } });
    }
  }

  return { suggestions, checks };
};
