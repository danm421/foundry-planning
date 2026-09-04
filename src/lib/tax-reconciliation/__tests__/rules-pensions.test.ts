import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { pensionRules } from "../rules/pensions";
import { CLIENT_ID, income, inputFixture, planFixture } from "./fixtures";
import type { PlanIncome } from "../types";

const factsWith = (gross: number | null) => { const f = emptyTaxReturnFacts(2025); f.income.pensionsGross = gross; return f; };
// `over` is typed, not `{}`: an untyped bag silently swallows a misspelled override.
const pension = (id: string, amount: number, over: Partial<PlanIncome> = {}) =>
  income({ id, type: "deferred", name: `Pension ${id}`, annualAmount: amount, growthRate: 0, inflationStartYear: 2025, ...over });

describe("pensionRules (5% / $500, return > $1,000)", () => {
  it("creates a flat pension when the plan has none", () => {
    const s = pensionRules(inputFixture({ facts: factsWith(24_000) })).suggestions[0];
    expect(s.id).toBe("income.pensions");
    expect(s.action?.target).toEqual({ kind: "income.create", amountField: "annualAmount",
      input: { type: "deferred", name: "Pension (from 2025 return)", owner: "client", annualAmount: 24_000, growthRate: 0, inflationStartYear: 2025, startYear: 2026, endYear: 2060 } });
    // Which side is which: $24,000 is what the return reports, $0 is what the plan carries.
    expect(s.kind).toBe("update");
    expect(s.returnFigure.amount).toBe(24_000);
    expect(s.returnFigure.lineRefs[0]).toMatchObject({ form: "1040", line: "5a", amount: 24_000 });
    expect(s.planFigure).toMatchObject({ label: "Pensions in the plan", amount: 0, display: "$0" });
    expect(s.delta.tone).toBe("missing");
    expect(s.action?.amountEditable).toBe(true);
    expect(s.action?.defaultAmount).toBe(24_000);
  });

  it("updates one row, reviews two, checks when in line, and stays silent under $1,000", () => {
    const one = pensionRules(inputFixture({ facts: factsWith(24_000), plan: planFixture({ incomes: [pension("p1", 20_000)] }) })).suggestions[0];
    expect(one.action?.target).toMatchObject({ kind: "income.update", incomeId: "p1", patch: { annualAmount: 24_000, inflationStartYear: 2025 } });
    const two = pensionRules(inputFixture({ facts: factsWith(24_000), plan: planFixture({ incomes: [pension("p1", 10_000), pension("p2", 10_000)] }) })).suggestions[0];
    expect(two.kind).toBe("review");
    const inline = pensionRules(inputFixture({ facts: factsWith(24_000), plan: planFixture({ incomes: [pension("p1", 23_800)] }) }));
    expect(inline.suggestions).toEqual([]);
    expect(inline.checks[0].id).toBe("income.pensions");
    expect(pensionRules(inputFixture({ facts: factsWith(900) })).suggestions).toEqual([]);
    // Both figures on the one-row card, so a return/plan swap cannot pass: the row is $20,000 and
    // the return is $24,000, and the check below prints the same pair the other way round.
    expect(one.returnFigure.amount).toBe(24_000);
    expect(one.planFigure).toMatchObject({ label: "Pension p1", amount: 20_000 });
    expect(one.delta.tone).toBe("short");
    expect(inline.checks).toEqual([{ id: "income.pensions", label: "Pensions", returnDisplay: "$24,000", planDisplay: "$23,800" }]);
  });

  it("takes the created row's span from plan settings, not from a hardcoded pair of years", () => {
    const plan = planFixture({ planSettings: { planStartYear: 2027, planEndYear: 2055, inflationRate: 0.03, residenceState: "PA", capitalLossCarryforwardLt: null, capitalLossCarryforwardSt: null } });
    const s = pensionRules(inputFixture({ facts: factsWith(24_000), plan })).suggestions[0];
    expect(s.action?.target).toMatchObject({ kind: "income.create", input: { startYear: 2027, endYear: 2055 } });
  });

  it("states the plan's pension in tax-year dollars, not plan-year dollars", () => {
    // $30,900 in the 2026 plan year at 3% growth is $30,000 in 2025 dollars. Reading the row at the
    // PLAN year would print $30,900 and shrink the gap the advisor is being shown.
    const plan = planFixture({ incomes: [pension("p1", 30_900, { growthRate: 0.03, inflationStartYear: null })] });
    const s = pensionRules(inputFixture({ facts: factsWith(24_000), plan })).suggestions[0];
    expect(s.planFigure.amount).toBeCloseTo(30_000, 0);
    expect(s.returnFigure.amount).toBe(24_000);
    expect(s.delta.tone).toBe("over");
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "p1", patch: { annualAmount: 24_000, inflationStartYear: 2025 } });
  });

  it("ignores income that is not a pension, and a pension that does not run in the plan year", () => {
    // A salary of exactly the return's size, plus a pension that stopped in 2020. Neither may count
    // toward the plan's pension figure, so the return's $24,000 is still entirely missing.
    const plan = planFixture({ incomes: [
      income({ id: "i1", type: "salary", name: "Acme Corp", annualAmount: 24_000 }),
      pension("p0", 24_000, { startYear: 2015, endYear: 2020 }),
    ] });
    const s = pensionRules(inputFixture({ facts: factsWith(24_000), plan })).suggestions[0];
    expect(s.planFigure.amount).toBe(0);
    expect(s.action?.target).toMatchObject({ kind: "income.create" });
  });

  it("names and writes to the one live pension when an ended one sits beside it", () => {
    // Only the live row is in play, so the card must name it and the write must land on it. Counting
    // the ended row would put $70,000 on screen and target the wrong id.
    const plan = planFixture({ incomes: [pension("p0", 50_000, { startYear: 2015, endYear: 2020 }), pension("p1", 20_000)] });
    const s = pensionRules(inputFixture({ facts: factsWith(24_000), plan })).suggestions[0];
    expect(s.planFigure).toMatchObject({ label: "Pension p1", amount: 20_000 });
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "p1" });
  });

  it("reviews a two-pension total without offering a write", () => {
    const plan = planFixture({ incomes: [pension("p1", 10_000), pension("p2", 10_000)] });
    const s = pensionRules(inputFixture({ facts: factsWith(24_000), plan })).suggestions[0];
    expect(s).toMatchObject({ id: "income.pensions", kind: "review" });
    expect(s.action).toBeUndefined(); // line 5a is one total; it cannot say which pension is off
    expect(s.planFigure).toMatchObject({ label: "Pensions in the plan", amount: 20_000 });
    expect(s.returnFigure.amount).toBe(24_000);
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/income-expenses`);
  });

  it("uses the 5% leg of the row tolerance, not a looser one", () => {
    // $20,000 against $18,500: a $1,500 gap, over the $500 floor and over 5% of the return ($1,000)
    // but under 10% ($2,000). Only the ROW tolerance flags it, so this is what separates ROW from
    // the looser W-2 and flow tolerances that sit beside it in compare.ts.
    const plan = planFixture({ incomes: [pension("p1", 18_500)] });
    const r = pensionRules(inputFixture({ facts: factsWith(20_000), plan }));
    expect(r.suggestions[0]?.action?.target).toMatchObject({ kind: "income.update", incomeId: "p1", patch: { annualAmount: 20_000 } });
    expect(r.checks).toEqual([]);
  });

  it("stays silent with no pension line at all, and at the $1,000 boundary", () => {
    expect(pensionRules(inputFixture({ facts: factsWith(null) }))).toEqual({ suggestions: [], checks: [] });
    expect(pensionRules(inputFixture({ facts: factsWith(1_000) }))).toEqual({ suggestions: [], checks: [] });
    // A pension the plan carries that the return never reports is NOT flagged: line 5a is blank in a
    // year with no distribution, so there is no plan-only arm here.
    const plan = planFixture({ incomes: [pension("p1", 20_000)] });
    expect(pensionRules(inputFixture({ facts: factsWith(null), plan }))).toEqual({ suggestions: [], checks: [] });
  });
});
