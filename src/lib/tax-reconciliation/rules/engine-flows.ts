import { detailsHref, makeDelta, money, n, planToTaxYear, ref, sum } from "../compare";
import type { Check, Rule, Suggestion } from "../types";

/** Each flow carries its OWN floor and ratio rather than one shared tolerance, because the spec's
 *  catalog sets a pair per flow (rows 185–189). Named here rather than left as bare literals so the
 *  carve-out is greppable and reads as deliberate, not as an oversight.
 *  `planShareOfReturn` is the share of the return's figure the plan must reach to stay quiet. */
const IRA_DISTRIBUTIONS = { floor: 1_000, planShareOfReturn: 0.5 };
const INVESTMENT_INCOME = { minGap: 2_000, returnMultipleOfPlan: 2 };
const CAPITAL_GAINS = { floor: 5_000, planShareOfReturn: 0.25 };
const OTHER_INCOME = { floor: 5_000, planShareOfReturn: 0.5 };

/** The four income flows that have no single plan ROW behind them — they fall out of the engine's
 *  own year, so every arm here reviews or reports and none offers a write.
 *
 *  All four comparisons are deliberately ONE-SIDED: they speak only when the plan carries far LESS
 *  than the return did. A plan that models more is not evidence of anything — the return is one
 *  filed year and the plan is a projection. Do not "fix" these into symmetric comparisons. */
export const engineFlowRules: Rule = (input) => {
  const { facts, plan, taxYear, planYear, engineYear } = input;
  const suggestions: Suggestion[] = [];
  const checks: Check[] = [];
  if (!engineYear) return { suggestions, checks };
  const byId = new Map(plan.accounts.map((a) => [a.id, a]));
  const cat = (id: string) => byId.get(id)?.category;

  const ira = facts.income.iraDistributionsGross;
  if (ira != null && ira > IRA_DISTRIBUTIONS.floor) {
    // Line 4a is money that left a QUALIFIED account, so only those categories count: a brokerage
    // draw is a sale, not an IRA distribution. RMDs ride alongside the discretionary withdrawals
    // because the engine books them separately, and an annuity can be qualified too.
    const draws = sum(Object.entries(engineYear.withdrawals.byAccount).filter(([id]) => cat(id) === "retirement" || cat(id) === "annuity").map(([, v]) => v));
    const rmds = sum(Object.entries(engineYear.accountLedgers).filter(([id]) => cat(id) === "retirement").map(([, l]) => l.rmdAmount));
    const p = planToTaxYear(input, draws + rmds);
    const id = "income.iraDistributions";
    const fig = { returnFigure: { label: "IRA distributions", amount: ira, display: money(ira), lineRefs: [ref("1040", "4a", "IRA distributions", ira)] }, planFigure: { label: "Retirement withdrawals + RMDs in the plan", amount: p, display: money(p), year: planYear } };
    if (p < IRA_DISTRIBUTIONS.planShareOfReturn * ira) suggestions.push({ id, section: "income", kind: "review", status: "open",
      headline: `${money(ira)} came out of IRAs in ${taxYear}; the plan draws ${money(p)} from retirement accounts in ${planYear}.`,
      // Line 4a is IRA money only, while the plan side counts every qualified draw — 401(k), 403(b)
      // and annuity distributions file on line 5a. The comparison stays as the spec sets it (this
      // arm only reviews, and `pensions.ts` already reconciles line 5a, so adding 5a here would
      // report one gap twice), but the copy has to say what the plan number contains.
      meaning: "If that money was spent, living expenses are understated — see the Spending card. If it was reinvested, a transfer to a taxable account is missing. The plan figure counts every retirement and annuity draw, including 401(k), 403(b) and annuity money that files on line 5a rather than 4a, so it can sit above line 4a on its own. Either way, the withdrawal strategy on Techniques decides which accounts the plan draws first.",
      ...fig, delta: makeDelta(ira, p), link: { label: "Open Techniques", href: detailsHref(input, "techniques") } });
    else checks.push({ id, label: "IRA distributions", returnDisplay: money(ira), planDisplay: money(p) });
  }

  // All three null means the return said nothing about yield, which is not the same as zero.
  const inv = facts.income.taxableInterest == null && facts.income.ordinaryDividends == null && facts.income.taxExemptInterest == null ? null : n(facts.income.taxableInterest) + n(facts.income.ordinaryDividends) + n(facts.income.taxExemptInterest);
  if (inv != null) {
    // Yield only — the income the account throws off. Realized gains have their own card below, and
    // `basisIncrease` is bookkeeping, not money the 1040 ever saw. A retirement account's growth is
    // invisible to a 1040 until it is distributed, so only taxable and cash count.
    const p = planToTaxYear(input, sum(Object.entries(engineYear.accountLedgers).filter(([id]) => cat(id) === "taxable" || cat(id) === "cash").map(([, l]) => n(l.growthDetail?.ordinaryIncome) + n(l.growthDetail?.qualifiedDividends) + n(l.growthDetail?.taxExempt))));
    const id = "income.investmentIncome";
    const fig = { returnFigure: { label: "Interest and dividends", amount: inv, display: money(inv), lineRefs: [ref("1040", "2a", "Tax-exempt interest", facts.income.taxExemptInterest), ref("1040", "2b", "Taxable interest", facts.income.taxableInterest), ref("1040", "3b", "Ordinary dividends", facts.income.ordinaryDividends)] }, planFigure: { label: "Taxable and cash account yield in the plan", amount: p, display: money(p), year: planYear } };
    if (inv > INVESTMENT_INCOME.returnMultipleOfPlan * p && inv - p > INVESTMENT_INCOME.minGap) suggestions.push({ id, section: "income", kind: "review", status: "open",
      headline: `The return shows ${money(inv)} of interest and dividends; the plan's taxable and cash accounts produce ${money(p)}.`,
      meaning: "Either a taxable account is missing from Net Worth, or its yield assumption is low for what it actually pays.",
      ...fig, delta: makeDelta(inv, p), link: { label: "Open Net Worth", href: detailsHref(input, "net-worth") } });
    else checks.push({ id, label: "Interest and dividends", returnDisplay: money(inv), planDisplay: money(p) });
  }

  // Schedule D is the better figure when it exists — line 7 is post-§1211(b) and can be capped at a
  // -$3,000 loss while the real short and long legs behind it were large.
  const hasSchedD = facts.income.netLongTermGain != null || facts.income.netShortTermGain != null;
  const gain = hasSchedD ? n(facts.income.netLongTermGain) + n(facts.income.netShortTermGain) : facts.income.capitalGainOrLoss;
  if (gain != null && gain > CAPITAL_GAINS.floor) {
    const p = planToTaxYear(input, n(engineYear.taxDetail?.capitalGains) + n(engineYear.taxDetail?.stCapitalGains));
    const id = "income.capitalGains";
    const fig = { returnFigure: { label: "Capital gains", amount: gain, display: money(gain), lineRefs: hasSchedD ? [ref("Sched D", "15", "Long-term gain", facts.income.netLongTermGain), ref("Sched D", "7", "Short-term gain", facts.income.netShortTermGain)] : [ref("1040", "7", "Capital gain or loss", gain)] }, planFigure: { label: "Gains the plan realizes", amount: p, display: money(p), year: planYear } };
    if (p < CAPITAL_GAINS.planShareOfReturn * gain) suggestions.push({ id, section: "income", kind: "review", status: "open",
      headline: `The household realized ${money(gain)} of capital gains in ${taxYear}; the plan realizes ${money(p)} in ${planYear}.`,
      meaning: "This is the gain, not the proceeds — the sale itself was larger. Gains that big usually mean money left the portfolio; if it was spent, see the Spending card. If it was rebalancing, raise the turnover on the account on Net Worth.",
      ...fig, delta: makeDelta(gain, p), link: { label: "Open Net Worth", href: detailsHref(input, "net-worth") } });
    else checks.push({ id, label: "Capital gains", returnDisplay: money(gain), planDisplay: money(p) });
  }

  const other = facts.income.unemployment == null && facts.income.otherIncome == null ? null : n(facts.income.unemployment) + n(facts.income.otherIncome);
  if (other != null && other > OTHER_INCOME.floor) {
    const p = planToTaxYear(input, engineYear.income.other);
    const id = "income.other";
    const fig = { returnFigure: { label: "Unemployment and other income", amount: other, display: money(other), lineRefs: [ref("Sched 1", "7", "Unemployment", facts.income.unemployment), ref("Sched 1", "9", "Other income", facts.income.otherIncome)] }, planFigure: { label: "Other income in the plan", amount: p, display: money(p), year: planYear } };
    // Info, not review: this one is usually a one-off, so it is reported and left alone.
    if (p < OTHER_INCOME.planShareOfReturn * other) suggestions.push({ id, section: "income", kind: "info", status: "open", headline: `The return shows ${money(other)} of other income the plan does not carry.`, meaning: "Unemployment and one-off income are usually not recurring; add a row only if this repeats.", ...fig, delta: makeDelta(other, p) });
    else checks.push({ id, label: "Other income", returnDisplay: money(other), planDisplay: money(p) });
  }

  return { suggestions, checks };
};
