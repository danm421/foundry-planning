import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, emptyAdjustmentsDetail, emptyScheduleE } from "@/lib/schemas/tax-return-facts";
import { spendingRule } from "../rules/spending";
import { CLIENT_ID, engineYearFixture, inputFixture, planFixture } from "./fixtures";
import type { PlanExpense } from "../types";

// Return: wages 150,000 + IRA 41,000 + SS 30,000 = 221,000 cash in; tax 30,000 + state 6,000; savings 0 → available 185,000.
const facts = () => { const f = emptyTaxReturnFacts(2025); f.income.wages = 150_000; f.income.iraDistributionsGross = 41_000; f.income.ssBenefitsGross = 30_000; f.income.totalIncome = 200_000; f.tax.totalTax = 30_000; return f; };
// Plan 2026: living 103,000 + liabilities 20,600 → 120,000 in 2025 dollars; savings 20,600 total, 5,150 employer, 10,300 pre-tax → after-tax 5,000.
const engineYear = () => engineYearFixture({
  expenses: { ...engineYearFixture().expenses, living: 103_000, liabilities: 20_600 },
  savings: { byAccount: {}, total: 20_600, employerTotal: 5_150 },
  deductionBreakdown: { aboveLine: { retirementContributions: 10_300, taggedExpenses: 0, manualEntries: 0, studentLoanInterest: 0, total: 10_300, bySource: {} }, belowLine: { charitable: 0, taxesPaid: 0, stateIncomeTax: 0, propertyTaxes: 0, interestPaid: 0, otherItemized: 0, itemizedTotal: 0, standardDeduction: 0, taxDeductions: 0, bySource: {} } },
});
const living = { id: "e1", type: "living" as const, name: "Living Expenses", annualAmount: 103_000, growthRate: 0.03, startYear: 2026, endYear: 2060, inflationStartYear: null, isDefault: true, startYearRef: null };
const retired = { ...living, id: "e2", name: "Retirement Living Expenses", startYear: 2035, startYearRef: "client_retirement" };
// `over` is typed, not `{}`: an untyped bag silently swallows a misspelled override, so a test could
// think it was pinning `isDefault` while the row kept the default.
const row = (over: Partial<PlanExpense>): PlanExpense => ({ ...living, ...over });
// Every predicate below is what ROUTES the write, so each gets a row that satisfies the other four.
const notCurrent = [
  { why: "not the default row", expense: row({ isDefault: false }) },
  { why: "not a living row", expense: row({ type: "other", name: "Boat" }) },
  { why: "already over by the plan year", expense: row({ startYear: 2020, endYear: 2025 }) },
  { why: "anchored to retirement", expense: row({ startYearRef: "client_retirement" }) },
  { why: "named for retirement", expense: row({ name: "Retirement spending" }) },
];

describe("spendingRule (gap > 10% of plan spend and > $10,000)", () => {
  it("raises the current default living-expense row by the gap, stated as an upper bound", () => {
    const r = spendingRule(inputFixture({ facts: facts(), engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [retired, living] }) }));
    const s = r.suggestions[0];
    expect(s.id).toBe("spending.implied");
    expect(s.returnFigure.amount).toBe(185_000);
    expect(s.planFigure.amount).toBeCloseTo(125_000, 0);      // 120,000 spend + 5,000 after-tax savings
    expect(s.delta.amount).toBeCloseTo(-60_000, 0);
    // living row is 100,000 in 2025 dollars; + 60,000 gap
    expect(s.action?.target).toMatchObject({ kind: "expense.update", expenseId: "e1", patch: { annualAmount: 160_000, inflationStartYear: 2025 } });
    expect(s.action?.defaultAmount).toBe(160_000);
    expect(s.meaning).toMatch(/upper bound/i);
    // The whole payload, not just the id: a swapped field has to redden here.
    expect(s).toMatchObject({ section: "spending", kind: "update", status: "open" });
    expect(s.action?.target).toEqual({ kind: "expense.update", expenseId: "e1", patch: { annualAmount: 160_000, inflationStartYear: 2025 }, amountField: "annualAmount" });
    expect(s.action).toMatchObject({ amountEditable: true });
    expect(s.action?.label).toMatch(/\$160,000/);
    expect(s.action?.describe).toMatch(/Living Expenses[\s\S]*\$160,000[\s\S]*2025 dollars/);
    expect(s.returnFigure).toMatchObject({ label: "Available to spend (cash in − taxes − retirement savings)", display: "$185,000" });
    expect(s.returnFigure.lineRefs).toEqual([
      { form: "1040", line: "9", label: "Total income", amount: 200_000 },
      { form: "1040", line: "24", label: "Total tax", amount: 30_000 },
    ]);
    expect(s.planFigure).toMatchObject({ label: "Plan spending + after-tax savings", display: "$125,000", year: 2026 });
    expect(s.delta).toMatchObject({ display: "Plan is $60,000 short", tone: "short" });
    // Ordered, so exchanging the two interpolations reddens while the prose stays free.
    expect(s.headline).toMatch(/\$185,000[\s\S]*\$125,000/);
    expect(s.meaning).toMatch(/\$60,000[\s\S]*Living Expenses[\s\S]*\$100,000[\s\S]*\$160,000/);
    // The write arm carries the action instead of a link out, as every other write arm does.
    expect(s.link).toBeUndefined();
    // A card that offers the write does not also report the pair as in line.
    expect(r.checks).toEqual([]);
    expect(r.suggestions).toHaveLength(1);
  });

  it("reviews when no current living row exists or the gap is negative; checks inside tolerance; skips without totals", () => {
    expect(spendingRule(inputFixture({ facts: facts(), engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [retired] }) })).suggestions[0].kind).toBe("review");
    const rich = engineYearFixture({ ...engineYear(), expenses: { ...engineYear().expenses, living: 250_000 } });
    expect(spendingRule(inputFixture({ facts: facts(), engineYear: rich, stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0].kind).toBe("review");
    const close = engineYearFixture({ ...engineYear(), expenses: { ...engineYear().expenses, living: 180_000 } });
    expect(spendingRule(inputFixture({ facts: facts(), engineYear: close, stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).checks[0].id).toBe("spending.implied");
    const noTax = facts(); noTax.tax.totalTax = null;
    expect(spendingRule(inputFixture({ facts: noTax, engineYear: engineYear(), plan: planFixture({ expenses: [living] }) }))).toEqual({ suggestions: [], checks: [] });

    // A plan that spends MORE than the return says came in never offers a write — raising the
    // living row would make the overshoot worse.
    const over = spendingRule(inputFixture({ facts: facts(), engineYear: rich, stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0];
    expect(over.action).toBeUndefined();
    expect(over.delta.tone).toBe("over");
    expect(over.meaning).toMatch(/upper bound/i);
    expect(over.link?.href).toBe(`/clients/${CLIENT_ID}/details/income-expenses`);
    expect(over.returnFigure).toMatchObject({ amount: 185_000, display: "$185,000" });
    expect(over.planFigure.amount).toBeCloseTo(267_718, 0);   // (250,000 + 20,600) / 1.03 + 5,000
    expect(over.headline).toMatch(/\$185,000[\s\S]*\$267,718/);

    // Inside tolerance the pair is simply reported, return first.
    expect(spendingRule(inputFixture({ facts: facts(), engineYear: close, stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })))
      .toEqual({ suggestions: [], checks: [{ id: "spending.implied", label: "Spending implied by the return", returnDisplay: "$185,000", planDisplay: "$199,757" }] });

    // Both other degrade paths: no engine year at all, and a return with no line 9.
    expect(spendingRule(inputFixture({ facts: facts(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) }))).toEqual({ suggestions: [], checks: [] });
    const noTotal = facts(); noTotal.income.totalIncome = null;
    expect(spendingRule(inputFixture({ facts: noTotal, engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) }))).toEqual({ suggestions: [], checks: [] });
  });

  it.each(notCurrent)("does not write to a living row that is $why", ({ expense }) => {
    // Each of these rows would be picked up if its predicate were dropped, and the write would land
    // on a row the return says nothing about — a retirement-era row raised by today's gap, or a
    // one-off "Boat" expense turned into the household's living costs.
    const r = spendingRule(inputFixture({ facts: facts(), engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [expense] }) }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "spending.implied", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].meaning).toMatch(/No current living-expense row/);
    // The pair still has to be right on the arm that offers no write.
    expect(r.suggestions[0].returnFigure).toMatchObject({ amount: 185_000, display: "$185,000" });
    expect(r.suggestions[0].planFigure.amount).toBeCloseTo(125_000, 0);
    expect(r.checks).toEqual([]);
  });

  it("builds the return side from cash actually in hand", () => {
    // State tax is subtracted alongside federal: without it there is $6,000 more to spend.
    const noState = spendingRule(inputFixture({ facts: facts(), engineYear: engineYear(), plan: planFixture({ expenses: [living] }) })).suggestions[0];
    expect(noState.returnFigure.amount).toBe(191_000);
    expect(noState.action?.target).toMatchObject({ patch: { annualAmount: 166_000 } });

    // Retirement saving off the top of a return is not spending, so it comes out of what is available.
    const saved = facts();
    saved.income.adjustmentsDetail = { ...emptyAdjustmentsDetail(), sepSimpleSolo401k: 10_000, hsaDeduction: 4_000 };
    const s = spendingRule(inputFixture({ facts: saved, engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0];
    expect(s.returnFigure.amount).toBe(171_000);
    expect(s.action?.target).toMatchObject({ patch: { annualAmount: 146_000 } });

    // A Schedule C LOSS is not negative spending money — it floors at zero — but a profit is cash in.
    const loss = facts(); loss.income.scheduleCNet = -50_000;
    expect(spendingRule(inputFixture({ facts: loss, engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0].returnFigure.amount).toBe(185_000);
    const profit = facts(); profit.income.scheduleCNet = 20_000;
    expect(spendingRule(inputFixture({ facts: profit, engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0].returnFigure.amount).toBe(205_000);

    // Rentals are the loss-on-paper / positive-in-cash case: depreciation is added back.
    const rental = facts();
    rental.income.scheduleENet = -6_000;
    rental.income.scheduleE = { ...emptyScheduleE(), depreciation: 10_000 };
    expect(spendingRule(inputFixture({ facts: rental, engineYear: engineYear(), stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0].returnFigure.amount).toBe(189_000);
  });

  it("builds the plan side from every spending bucket except tax, and only after-tax saving", () => {
    // Tax is already subtracted on the RETURN side; counting the plan's tax here would double it.
    const buckets = engineYearFixture({ ...engineYear(), expenses: { ...engineYear().expenses, other: 1_030, insurance: 1_030, realEstate: 1_030, discretionary: 1_030, taxes: 100_000 } });
    const s = spendingRule(inputFixture({ facts: facts(), engineYear: buckets, stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0];
    expect(s.planFigure.amount).toBeCloseTo(129_000, 0);      // 124,000 spend + 5,000 after-tax savings
    expect(s.action?.target).toMatchObject({ patch: { annualAmount: 156_000 } });

    // Employer money and pre-tax deferrals are not after-tax saving, and the subtraction floors at
    // zero rather than crediting the plan with negative saving.
    const allPreTax = engineYearFixture({ ...engineYear(), savings: { byAccount: {}, total: 5_150, employerTotal: 5_150 } });
    const floored = spendingRule(inputFixture({ facts: facts(), engineYear: allPreTax, stateTaxEstimate: 6_000, plan: planFixture({ expenses: [living] }) })).suggestions[0];
    expect(floored.planFigure.amount).toBeCloseTo(120_000, 0);
    expect(floored.action?.target).toMatchObject({ patch: { annualAmount: 165_000 } });
  });
});
