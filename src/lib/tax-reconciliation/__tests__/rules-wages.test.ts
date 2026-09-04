import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { wageRules } from "../rules/wages";
import { engineYearFixture, income, inputFixture, planFixture } from "./fixtures";

const w2 = (employer: string | null, wages: number | null) => ({ employer, wages });
const salary = (id: string, name: string, amount: number, over = {}) => income({ id, type: "salary", name, annualAmount: amount, ...over });

describe("wageRules — per W-2 (10% / $500)", () => {
  it("updates a matched row whose tax-year figure differs, naming the row and writing inflationStartYear", () => {
    // Row is 154,500 in 2026 with no inflationStartYear → 150,000 in 2025 dollars.
    // W-2 says 170,000: a 20,000 gap, over both $500 and 10% of the return figure (17,000).
    const plan = planFixture({ incomes: [salary("i1", "Acme Corp", 154_500)] });
    const r = wageRules(inputFixture({ w2s: [w2("ACME CORPORATION", 170_000)], plan }));
    const s = r.suggestions.find((x) => x.id === "income.wages.w2.0")!;
    expect(s.kind).toBe("update");
    expect(s.headline).toMatch(/Acme Corp/);
    expect(s.planFigure.amount).toBeCloseTo(150_000, 0);
    expect(s.returnFigure.amount).toBe(170_000);
    expect(s.delta.tone).toBe("short"); // the plan is short of the return, not over it
    expect(s.meaning).not.toMatch(/401\(k\)/); // this plan has no deferral rule, so no deferral note
    expect(s.action?.target).toEqual({ kind: "income.update", incomeId: "i1", patch: { annualAmount: 170_000, inflationStartYear: 2025 }, amountField: "annualAmount" });
    expect(s.action?.defaultAmount).toBe(170_000);
    expect(s.returnFigure.lineRefs[0]).toMatchObject({ form: "W-2", line: "Box 1" });
  });

  it("is in line inside the W-2 tolerance and says so with both figures", () => {
    const plan = planFixture({ incomes: [salary("i1", "Acme Corp", 154_500)] });
    const r = wageRules(inputFixture({ w2s: [w2("Acme", 158_000)], plan })); // 5.3% / $8,000 → under 10%
    expect(r.suggestions).toEqual([]);
    expect(r.checks[0]).toMatchObject({ id: "income.wages.w2.0", returnDisplay: "$158,000", planDisplay: "$150,000" });
  });

  it("mentions pre-tax deferrals when a 401(k) rule exists", () => {
    const plan = planFixture({
      incomes: [salary("i1", "Acme Corp", 154_500)],
      accounts: [{ id: "a1", name: "401(k)", category: "retirement", subType: "401k" }],
      savingsRules: [{ id: "r1", accountId: "a1", annualAmount: 23_000, startYear: 2026, endYear: 2060 }],
    });
    const s = wageRules(inputFixture({ w2s: [w2("Acme", 120_000)], plan })).suggestions[0];
    expect(s.meaning).toMatch(/401\(k\)/);
  });

  it("creates a salary for an unmatched W-2 over $1,000, with an owner choice when there is a spouse", () => {
    const r = wageRules(inputFixture({ w2s: [w2("Globex", 90_000), w2("Tiny Gig", 800)] }));
    expect(r.suggestions.map((s) => s.id)).toEqual(["income.wages.w2.0.create"]);
    const s = r.suggestions[0];
    expect(s.action?.ownerChoices).toEqual(["client", "spouse"]);
    expect(s.action?.target).toEqual({
      kind: "income.create", amountField: "annualAmount", ownerField: "owner",
      input: { type: "salary", name: "Globex", owner: "client", annualAmount: 90_000, growthRate: 0.03, inflationStartYear: 2025, startYear: 2026, endYear: 2060, endYearRef: "client_retirement" },
    });
  });

  it("offers no owner choice for a single filer", () => {
    const plan = planFixture({ client: { filingStatus: "single", dateOfBirth: "1960-04-02", spouseDob: null }, familyMembers: [] });
    const s = wageRules(inputFixture({ w2s: [w2("Globex", 90_000)], plan })).suggestions[0];
    expect(s.action?.ownerChoices).toBeUndefined();
  });

  it("checks off a job that ended in the tax year instead of offering to re-create it", () => {
    // The retirement / job-change year. The row ran 2015–2025 and is worth $207,635 in 2025 dollars,
    // so if the matcher could see it at all it would want to *update* it to the W-2's $100,000; if it
    // could not see it, it would want to *create* a brand-new salary running to retirement — which
    // re-employs a client who has just retired. Neither is right: assert an empty suggestion list,
    // and a check that names the year the job ended.
    const plan = planFixture({ incomes: [salary("i1", "Acme Corp", 154_500, { startYear: 2015, endYear: 2025 })] });
    const r = wageRules(inputFixture({ w2s: [w2("ACME CORPORATION", 100_000)], plan }));
    expect(r.suggestions).toEqual([]);
    expect(r.checks).toEqual([
      { id: "income.wages.w2.0", label: "Wages · ACME CORPORATION", returnDisplay: "$100,000", planDisplay: "Ends in 2025, before the 2026 plan year" },
    ]);
  });

  it("does not offer one plan row to two W-2s", () => {
    const plan = planFixture({ incomes: [salary("i1", "Acme", 100_000)] });
    const r = wageRules(inputFixture({ w2s: [w2("Acme", 100_000), w2("Acme Holdings", 40_000)], plan }));
    expect(r.suggestions.map((s) => s.id)).toEqual(["income.wages.w2.1.create"]);
  });

  it("flags a salary row no W-2 matched when the return's wages fall short of the plan", () => {
    const f = emptyTaxReturnFacts(2025); f.income.wages = 100_000;
    const plan = planFixture({ incomes: [salary("i1", "Acme", 100_000), salary("i2", "Old Job", 60_000)] });
    const r = wageRules(inputFixture({ facts: f, w2s: [w2("Acme", 100_000)], plan }));
    const s = r.suggestions.find((x) => x.id === "income.wages.unmatchedRow.i2")!;
    expect(s.kind).toBe("review");
    expect(s.headline).toMatch(/Old Job/);
    // The card's plan figure is the unmatched ROW, not the plan's salary total.
    expect(s.planFigure.label).toBe("Old Job");
    expect(s.returnFigure.amount).toBe(100_000);
    expect(s.link?.href).toMatch(/income-expenses$/);
  });
});

describe("wageRules — income.wages.total (no W-2 documents, 5% / $500)", () => {
  it("creates a wages row when the plan has none", () => {
    const f = emptyTaxReturnFacts(2025); f.income.wages = 80_000;
    const s = wageRules(inputFixture({ facts: f })).suggestions[0];
    expect(s.id).toBe("income.wages.total");
    expect(s.action?.target).toMatchObject({ kind: "income.create", input: { name: "Wages (from 2025 return)", annualAmount: 80_000 } });
  });
  it("updates the single row, adding back the engine's pre-tax deferrals so the row stays gross", () => {
    const f = emptyTaxReturnFacts(2025); f.income.wages = 80_000;
    const plan = planFixture({ incomes: [salary("i1", "Acme", 100_000, { inflationStartYear: 2025 })] });
    const engineYear = engineYearFixture({ deductionBreakdown: { aboveLine: { retirementContributions: 10_300, taggedExpenses: 0, manualEntries: 0, studentLoanInterest: 0, total: 10_300, bySource: {} }, belowLine: { charitable: 0, taxesPaid: 0, stateIncomeTax: 0, propertyTaxes: 0, interestPaid: 0, otherItemized: 0, itemizedTotal: 0, standardDeduction: 0, taxDeductions: 0, bySource: {} } } });
    const s = wageRules(inputFixture({ facts: f, plan, engineYear })).suggestions[0];
    // plan box-1 equivalent = 100,000 − 10,300/1.03 = 90,000; return 80,000 → differs
    expect(s.planFigure.amount).toBeCloseTo(90_000, 0);
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "i1", patch: { annualAmount: 90_000, inflationStartYear: 2025 } });
  });
  it("wrong-field guard: the write-back amount, the plan figure and the return figure are three different numbers", () => {
    // The test above cannot separate them — 100,000 − 10,000 and 80,000 + 10,000 are both 90,000,
    // so swapping the plan figure for the write-back amount would stay green. Here the row is
    // 120,000, which pulls the three apart: return 80,000 · plan 110,000 · write-back 90,000.
    const f = emptyTaxReturnFacts(2025); f.income.wages = 80_000;
    const plan = planFixture({ incomes: [salary("i1", "Acme", 120_000, { inflationStartYear: 2025 })] });
    const engineYear = engineYearFixture({ deductionBreakdown: { aboveLine: { retirementContributions: 10_300, taggedExpenses: 0, manualEntries: 0, studentLoanInterest: 0, total: 10_300, bySource: {} }, belowLine: { charitable: 0, taxesPaid: 0, stateIncomeTax: 0, propertyTaxes: 0, interestPaid: 0, otherItemized: 0, itemizedTotal: 0, standardDeduction: 0, taxDeductions: 0, bySource: {} } } });
    const s = wageRules(inputFixture({ facts: f, plan, engineYear })).suggestions[0];
    expect(s.returnFigure.amount).toBe(80_000);
    expect(s.planFigure.amount).toBeCloseTo(110_000, 0);
    expect(s.action?.defaultAmount).toBe(90_000);
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "i1", patch: { annualAmount: 90_000 } });
  });
  it("counts only rows active in the plan year, so an ended job does not force a review", () => {
    // The other half of the matcher fix: matching sees every salary row, but the aggregates stay on
    // the ACTIVE subset. If the ended row were counted here the advisor would get a "which salary is
    // off?" review instead of the one-click update on the job they actually still hold.
    const f = emptyTaxReturnFacts(2025); f.income.wages = 80_000;
    const plan = planFixture({ incomes: [
      salary("i1", "Acme", 100_000, { inflationStartYear: 2025 }),
      salary("i2", "Old Job", 60_000, { startYear: 2015, endYear: 2025 }),
    ] });
    const s = wageRules(inputFixture({ facts: f, plan })).suggestions[0];
    expect(s.kind).toBe("update");
    expect(s.planFigure.label).toBe("Acme");
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "i1", patch: { annualAmount: 80_000 } });
  });
  it("sends two or more rows to review", () => {
    const f = emptyTaxReturnFacts(2025); f.income.wages = 80_000;
    const plan = planFixture({ incomes: [salary("i1", "A", 60_000), salary("i2", "B", 60_000)] });
    const s = wageRules(inputFixture({ facts: f, plan })).suggestions[0];
    expect(s.kind).toBe("review");
    expect(s.action).toBeUndefined(); // line 1a cannot say which row is off, so there is no one-click write
  });
  it("wrong-field guard: a matched W-2 update names the matched row's id, not the first row's", () => {
    const plan = planFixture({ incomes: [salary("i1", "Initech", 50_000), salary("i2", "Acme Corp", 154_500)] });
    const s = wageRules(inputFixture({ w2s: [w2("Acme", 200_000)], plan })).suggestions[0];
    expect(s.action?.target).toMatchObject({ incomeId: "i2" });
  });
});
