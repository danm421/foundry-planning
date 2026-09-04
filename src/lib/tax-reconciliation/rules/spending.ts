import { SPEND, detailsHref, isActiveInYear, makeDelta, money, n, planToTaxYear, ref, rowAmountInYear } from "../compare";
import type { Rule } from "../types";

/** What the return implies the household actually spent, against what the plan spends and saves.
 *
 *  A 1040 never states spending, so it is derived: cash in, less the tax paid, less the retirement
 *  saving the return itself discloses. Saving into a taxable or Roth account leaves no trace on a
 *  1040, so the gap is an UPPER BOUND on the spending the plan is missing — the copy says so on
 *  every arm, because an advisor who takes it as exact will overstate expenses for life. */
export const spendingRule: Rule = (input) => {
  const { facts, plan, taxYear, planYear, engineYear, stateTaxEstimate, ficaEstimate } = input;
  const inc = facts.income;
  if (!engineYear || inc.totalIncome == null || facts.tax.totalTax == null) return { suggestions: [], checks: [] };
  // Depreciation is a non-cash deduction, so a rental that nets to a loss can still be cash in.
  const rentalCash = n(inc.scheduleENet) + n(inc.scheduleE?.depreciation);
  // Gross, not taxable: the whole IRA draw and the whole Social Security benefit were spendable.
  // A Schedule C LOSS is floored at zero — it is not negative money to spend.
  const cashIn = n(inc.wages) + n(inc.taxableInterest) + n(inc.taxExemptInterest) + n(inc.ordinaryDividends) + n(inc.iraDistributionsGross) + n(inc.pensionsGross) + n(inc.ssBenefitsGross) + Math.max(0, n(inc.scheduleCNet)) + rentalCash + n(inc.unemployment) + n(inc.otherIncome);
  // FICA is deliberately part of this, even though line 24 is not. Employee Social Security and
  // Medicare withholding appears only on W-2 boxes 4 and 6 — never on the 1040 — so leaving it out
  // counts up to the wage-base maximum of money the household never saw as available to spend, and
  // every dollar of that overstatement lands in the write below. The plan side excludes
  // `expenses.taxes`, and the engine's own tax total includes FICA, so both sides now agree.
  const taxes = facts.tax.totalTax + stateTaxEstimate + ficaEstimate;
  const savingsOnReturn = n(inc.adjustmentsDetail?.sepSimpleSolo401k) + n(inc.adjustmentsDetail?.hsaDeduction);
  const available = Math.round(cashIn - taxes - savingsOnReturn);
  // Every spending bucket EXCEPT tax: the return's own tax is already out of `available`, so
  // counting the plan's would subtract it twice.
  const e = engineYear.expenses;
  const spend = planToTaxYear(input, e.living + e.other + e.insurance + e.liabilities + e.realEstate + e.discretionary);
  // Only saving that came out of after-tax money belongs beside spending, so the pre-tax deferral
  // comes off — it is already outside `available`, which starts from gross cash in.
  //
  // The employer match is deliberately NOT subtracted here, however obvious that looks: it was
  // never in `savings.total` to begin with. `src/engine/savings.ts` accumulates employee
  // contributions into `total` and the match into a SEPARATE `employerTotal`, and never adds one
  // into the other — `projection.ts` debits household checking by `savings.total` alone and credits
  // the match in its own pass. Subtracting it would understate the plan side and inflate the write
  // below by the whole match, every year, for the life of the projection.
  const afterTax = planToTaxYear(input, Math.max(0, engineYear.savings.total - n(engineYear.deductionBreakdown?.aboveLine.retirementContributions)));
  const planSide = spend + afterTax;
  const gap = available - planSide;
  const id = "spending.implied";
  const returnFigure = { label: "Available to spend (cash in − taxes − retirement savings)", amount: available, display: money(available), lineRefs: [ref("1040", "9", "Total income", inc.totalIncome), ref("1040", "24", "Total tax", facts.tax.totalTax)] };
  const planFigure = { label: "Plan spending + after-tax savings", amount: planSide, display: money(planSide), year: planYear };
  if (!(Math.abs(gap) > SPEND.abs && Math.abs(gap) > SPEND.pct * spend)) return { suggestions: [], checks: [{ id, label: "Spending implied by the return", returnDisplay: money(available), planDisplay: money(planSide) }] };
  const bound = "Money saved into taxable or Roth accounts is invisible to a 1040, so this gap is an upper bound on the spending the plan is missing.";
  const link = { label: "Open Inflows & Outflows", href: detailsHref(input, "income-expenses") };
  if (gap < 0) return { suggestions: [{ id, section: "spending", kind: "review", status: "open", headline: `The return leaves ${money(available)} to spend after tax; the plan spends and saves ${money(planSide)}.`, meaning: `The plan spends more than the return says came in. Either income is missing from the return's picture (gifts, loans, drawing down cash) or the plan's expenses are high. ${bound}`, returnFigure, planFigure, delta: makeDelta(available, planSide), link }], checks: [] };
  // The write has to land on the row the household lives on TODAY. Every predicate is load-bearing:
  // a non-default row, a row of another type, one that is over by the plan year, and the two shapes
  // of retirement-era row (anchored by `startYearRef`, or named for it) would each take a gap
  // measured in the tax year and apply it to spending the advisor modelled for a different life.
  const row = plan.expenses.find((x) => x.isDefault && x.type === "living" && isActiveInYear(x, planYear) && x.startYearRef !== "client_retirement" && !/retire/i.test(x.name));
  if (!row) return { suggestions: [{ id, section: "spending", kind: "review", status: "open", headline: `The return leaves ${money(available)} to spend after tax; the plan spends and saves ${money(planSide)}.`, meaning: `About ${money(gap)} a year went somewhere the plan does not show. No current living-expense row was found to raise; adjust spending on Inflows & Outflows. ${bound}`, returnFigure, planFigure, delta: makeDelta(available, planSide), link }], checks: [] };
  const current = rowAmountInYear(row, taxYear);
  const amount = Math.round(current + gap);
  return { suggestions: [{ id, section: "spending", kind: "update", status: "open",
    headline: `The return leaves ${money(available)} to spend after tax; the plan spends and saves ${money(planSide)}.`,
    meaning: `About ${money(gap)} a year went somewhere the plan does not show — most often living expenses. This raises ${row.name} from ${money(current)} to ${money(amount)} in ${taxYear} dollars. ${bound}`,
    returnFigure, planFigure, delta: makeDelta(available, planSide),
    action: { label: `Raise living expenses to ${money(amount)}`, describe: `Sets ${row.name} to ${money(amount)} (${taxYear} dollars)`, amountEditable: true, defaultAmount: amount, target: { kind: "expense.update", expenseId: row.id, patch: { annualAmount: amount, inflationStartYear: taxYear }, amountField: "annualAmount" } } }], checks: [] };
};
