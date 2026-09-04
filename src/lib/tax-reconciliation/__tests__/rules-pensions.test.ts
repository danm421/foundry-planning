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
    expect(s.action?.target).toEqual({ kind: "income.create", amountField: "annualAmount", ownerField: "owner",
      input: { type: "deferred", name: "Pension (from 2025 return)", owner: "client", annualAmount: 24_000, growthRate: 0, inflationStartYear: 2025, startYear: 2026, endYear: 2060 } });
    // Line 5a is a household total on a joint return, and ownership drives survivor modelling: a
    // spouse's pension booked to the client stops paying at the wrong death.
    expect(s.action?.ownerChoices).toEqual(["client", "spouse"]);
    // Which side is which: $24,000 is what the return reports, $0 is what the plan carries.
    expect(s.kind).toBe("update");
    expect(s.returnFigure.amount).toBe(24_000);
    expect(s.returnFigure.lineRefs[0]).toMatchObject({ form: "1040", line: "5a", amount: 24_000 });
    expect(s.planFigure).toMatchObject({ label: "Pensions in the plan", amount: 0, display: "$0" });
    expect(s.delta.tone).toBe("missing");
    expect(s.action?.amountEditable).toBe(true);
    expect(s.action?.defaultAmount).toBe(24_000);
    expect(s.action?.label).toMatch(/\$24,000/);
    expect(s.action?.describe).toMatch(/\$24,000/);
  });

  it("offers no owner choice on the created pension when there is no spouse", () => {
    const plan = planFixture({ client: { filingStatus: "single", dateOfBirth: "1960-04-02", spouseDob: null }, familyMembers: [] });
    const s = pensionRules(inputFixture({ facts: factsWith(24_000), plan })).suggestions[0];
    expect(s.action?.ownerChoices).toBeUndefined();
    expect(s.action?.target).toMatchObject({ kind: "income.create", ownerField: "owner", input: { owner: "client" } });
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
    // Ordered: the return's figure, then the plan's. Exchanging them leaves the prose intact.
    expect(one.headline).toMatch(/\$24,000[\s\S]*\$20,000/);
    expect(one.action?.label).toMatch(/\$24,000/);
    expect(one.action?.describe).toMatch(/\$24,000/);
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
    expect(s.headline).toMatch(/2 pensions/);           // the count is the rows being compared
    expect(s.headline).toMatch(/\$24,000[\s\S]*\$20,000/); // return first, then the plan
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

  it("does not offer to restart a pension the plan models as ending in the tax year", () => {
    // The harmful shape: the row ran THROUGH 2025 and stops before the 2026 plan year. It drops out
    // of the plan-year sum by design, so the plan looks to carry no pension at all and the create
    // arm would add one back from 2026 to 2060 — a stream the advisor deliberately ended.
    const plan = planFixture({ incomes: [pension("p1", 24_000, { startYear: 2015, endYear: 2025 })] });
    const r = pensionRules(inputFixture({ facts: factsWith(24_000), plan }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "income.pensions", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].headline).toMatch(/Pension p1[\s\S]*2025[\s\S]*2026/);
    expect(r.suggestions[0].headline).toMatch(/\$24,000/);
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "Pension p1", amount: 0, display: "$0", year: 2026 });
    expect(r.suggestions[0].link?.href).toBe(`/clients/${CLIENT_ID}/details/income-expenses`);
    expect(r.checks).toEqual([]);
    // A pension that ended long BEFORE the tax year is untouched by this arm: the return year says
    // nothing about it, so the create still stands.
    const old = planFixture({ incomes: [pension("p0", 24_000, { startYear: 2015, endYear: 2020 })] });
    expect(pensionRules(inputFixture({ facts: factsWith(24_000), plan: old })).suggestions[0].action?.target).toMatchObject({ kind: "income.create" });
  });

  it("does not offer a second pension alongside one the plan starts later", () => {
    // The mirror-image gap to the ending case, and the harmful one: a row that starts AFTER the plan
    // year is in neither the plan-year aggregate nor the ending set, so the $24,000 falls to the
    // create arm — and the new 2026-2060 row would then pay the pension TWICE from 2030 on.
    const plan = planFixture({ incomes: [pension("p1", 24_000, { startYear: 2030, endYear: 2060 })] });
    const r = pensionRules(inputFixture({ facts: factsWith(24_000), plan }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "income.pensions", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].headline).toMatch(/Pension p1[\s\S]*2030/);
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "Pension p1", amount: 0, display: "$0", year: 2026 });
    expect(r.suggestions[0].link?.href).toBe(`/clients/${CLIENT_ID}/details/income-expenses`);
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
