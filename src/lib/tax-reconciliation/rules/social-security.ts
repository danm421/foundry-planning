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
  const outflows = { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") };
  // Line 6a is a whole-year total only where benefits ran all year. In the first year they are paid
  // it covers the months received, and the return does not carry the month — so every arm that
  // writes the figure names the assumption instead of calling the figure the award.
  const partialYearNote = `If benefits began part-way through ${taxYear}, line 6a covers only the months received, so check the amount before applying it.`;

  // A row is claimable only where claiming it would actually do something. It has to belong to ONE
  // person, because apply.ts writes the amount by owner; it must not have already ended, because the
  // patch moves startYear and never endYear, so an ended row would be "claimed" into a benefit that
  // still pays nothing; and its owner needs a date of birth, or claimingAge goes in as null and
  // quietly erases the age already stated on the row. Ages under 62 stay — SSDI is a real case.
  // startYear takes the EARLIER of the row's start and the plan's, for the same reason the endYear
  // test exists: a row that does not begin until 2030 would otherwise still pay nothing once claimed.
  const claimRows = rows.flatMap((r) => {
    if (r.owner !== "client" && r.owner !== "spouse") return [];
    if (r.endYear < planYear) return [];
    const claimingAge = ageAtYearEnd(dobFor(r.owner), taxYear);
    if (claimingAge == null) return [];
    return [{
      owner: r.owner, incomeId: r.id,
      patch: { ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge, startYear: Math.min(r.startYear, plan.planSettings.planStartYear), inflationStartYear: taxYear },
    }];
  });

  // A pia_at_fra row is priced by the benefit orchestrator, and rowAmountInYear returns 0 for it by
  // design. With no engine run that $0 is an artifact of the missing projection, not the plan's
  // answer: reporting it would headline "the plan pays $0" and offer one click that rewrites a
  // PIA-driven row to a stated amount on the strength of it.
  const piaUnpriced = engineYear == null && active.some((r) => n(r.piaMonthly) > 0 && r.annualAmount <= 0);

  if (piaUnpriced) {
    suggestions.push({ id: "income.socialSecurity.noProjection", section: "income", kind: "review", status: "open",
      headline: "The plan's Social Security cannot be stated: the projection did not run.",
      meaning: "The row carries a benefit at full retirement age rather than a dollar figure, and only a projection turns that into a yearly amount. Without one the plan's benefit is unknown rather than zero. Re-run the plan, or state the benefit as an annual amount on the row.",
      returnFigure, planFigure: { label: "Social Security in the plan", amount: null, display: money(null), year: planYear },
      delta: { amount: null, display: "Not known", tone: "neutral" }, link: outflows });
  } else if (gross != null && gross > 500) {
    if (active.length === 0) {
      const planFigure = { label: "Social Security in the plan", amount: 0, display: money(0), year: planYear };
      if (claimRows.length === 0) {
        suggestions.push({ id: "income.socialSecurity", section: "income", kind: "review", status: "open",
          headline: "Social Security is on the return but the plan has no row that can carry it.",
          meaning: `The household received ${money(gross)} in ${taxYear}. No row here can be claimed: either there is no Social Security row, or the ones there are jointly owned, have already ended, or have no date of birth to set a claiming age from. Add or fix a Social Security income on Inflows & Outflows and enter the benefit.`,
          returnFigure, planFigure, delta: makeDelta(gross, 0), link: outflows });
      } else {
        // The rows exist but pay nothing, so this is the un-claimed seed: benefits have started in
        // real life and the plan has not been told. `apply.ts` sets the amount from the owner
        // choice, which is why each row carries its patch already built and no annualAmount.
        const both = claimRows.length >= 2;
        suggestions.push({ id: "income.socialSecurity", section: "income", kind: "update", status: "open",
          headline: "Social Security is on the return but not in the plan yet.",
          meaning: `The household received ${money(gross)} in ${taxYear}, so benefits have already started. This records the benefit as an annual amount already being claimed${both ? "; the return does not say whose, so choose who receives it" : ""}. ${partialYearNote}`,
          returnFigure, planFigure, delta: makeDelta(gross, 0),
          action: { label: `Record ${money(gross)} of Social Security`, describe: `Marks Social Security as claimed at ${money(gross)} a year (${taxYear} dollars)`, amountEditable: true, defaultAmount: gross,
            ownerChoices: both ? ["client", "spouse", "split"] : undefined,
            target: { kind: "income.socialSecurity.claim", rows: claimRows, amount: gross } } });
      }
    } else if (active.length === 1) {
      const row = active[0];
      const p = inTaxYear(row);
      const planFigure = { label: row.name, amount: p, display: money(p), year: planYear };
      const headline = `The return shows ${money(gross)} of Social Security; the plan pays ${money(p)} in ${taxYear} dollars.`;
      if (!differs(gross, p, ROW)) {
        checks.push({ id: "income.socialSecurity.amount", label: "Social Security", returnDisplay: money(gross), planDisplay: money(p) });
      } else if (row.startYear === taxYear) {
        // The plan itself says benefits begin in the tax year, so line 6a is a part-year figure by
        // construction. The return does not carry the claim month, so there is nothing honest to
        // annualise from — hand it to the advisor rather than write a part year in as a full one.
        suggestions.push({ id: "income.socialSecurity.amount", section: "income", kind: "review", status: "open",
          headline,
          meaning: `The plan starts this benefit in ${taxYear}, so line 6a covers only the months received that year rather than a full year's award. Set the full-year benefit on Inflows & Outflows.`,
          returnFigure, planFigure, delta: makeDelta(gross, p), link: outflows });
      } else {
        suggestions.push({ id: "income.socialSecurity.amount", section: "income", kind: "update", status: "open",
          headline,
          meaning: `Setting the row to the return's figure switches it to a stated annual amount and grows it from the tax year. ${partialYearNote}`,
          returnFigure, planFigure, delta: makeDelta(gross, p),
          action: { label: `Set benefit to ${money(gross)}`, describe: `Sets ${row.name} to ${money(gross)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: gross,
            target: { kind: "income.update", incomeId: row.id, patch: { ssBenefitMode: "manual_amount", annualAmount: gross, inflationStartYear: taxYear }, amountField: "annualAmount" } } });
      }
    } else {
      const p = sum(active.map(inTaxYear));
      const planFigure = { label: "Social Security (both)", amount: p, display: money(p), year: planYear };
      if (differs(gross, p, ROW)) {
        suggestions.push({ id: "income.socialSecurity.split", section: "income", kind: "review", status: "open",
          headline: `The return shows ${money(gross)} of Social Security; the plan's ${active.length} benefits total ${money(p)}.`,
          meaning: "Line 6a is the household total, so which benefit is off cannot be told from the return. Adjust the rows on Inflows & Outflows.",
          returnFigure, planFigure, delta: makeDelta(gross, p), link: outflows });
      } else checks.push({ id: "income.socialSecurity.split", label: "Social Security", returnDisplay: money(gross), planDisplay: money(p) });
    }
  } else if (active.length > 0) {
    // This arm also catches a 6a of $1–$500, under the gate. Naming that figure keeps the headline
    // and the delta telling the same story — "shows none" beside a $300 return was both.
    const p = sum(active.map(inTaxYear));
    const onReturn = gross != null && gross > 0;
    suggestions.push({ id: "income.socialSecurity.planOnly", section: "income", kind: "info", status: "open",
      headline: `The plan pays ${money(p)} of Social Security in ${planYear}; the ${taxYear} return shows ${onReturn ? `only ${money(gross)}` : "none"}.`,
      meaning: "Fine if benefits start this year. If they have not been claimed, check the claiming age on the row.",
      returnFigure, planFigure: { label: "Social Security in the plan", amount: p, display: money(p), year: planYear }, delta: makeDelta(gross, p) });
  }

  return { suggestions, checks };
};
