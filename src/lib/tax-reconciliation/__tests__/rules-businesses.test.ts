import { describe, it, expect } from "vitest";
import { emptyBusiness, emptyK1, emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { businessRules } from "../rules/businesses";
import { CLIENT_ID, income, inputFixture, planFixture } from "./fixtures";
import type { PlanIncome } from "../types";

const schedC = (name: string, netProfit: number) => ({ ...emptyBusiness(), name, netProfit });
const k1 = (entityName: string, over: Partial<ReturnType<typeof emptyK1>> = {}) => ({ ...emptyK1(), entityName, ...over });
// `over` is typed, not `{}`: an untyped bag silently swallows a misspelled override, so a test could
// think it was pinning `startYear` while the row kept the fixture default.
const biz = (id: string, name: string, amount: number, over: Partial<PlanIncome> = {}) =>
  income({ id, type: "business", name, annualAmount: amount, growthRate: 0, inflationStartYear: 2025, ...over });

describe("businessRules — Schedule C", () => {
  it("creates a business income for an unmatched profitable Schedule C", () => {
    const f = emptyTaxReturnFacts(2025); f.businesses = [schedC("Dan's Consulting LLC", 85_000)];
    const s = businessRules(inputFixture({ facts: f })).suggestions[0];
    expect(s.id).toBe("business.scheduleC.0");
    expect(s.action?.target).toEqual({ kind: "income.create", amountField: "annualAmount",
      input: { type: "business", name: "Dan's Consulting LLC", owner: "client", annualAmount: 85_000, growthRate: 0.03, inflationStartYear: 2025, startYear: 2026, endYear: 2060 } });
    expect(s.returnFigure.lineRefs[0]).toMatchObject({ form: "Sched C", line: "31" });
    // Which side is which: $85,000 is what the return reports, and the plan carries nothing at all.
    expect(s.returnFigure).toMatchObject({ amount: 85_000, display: "$85,000" });
    expect(s.planFigure).toMatchObject({ label: "No matching business", amount: null, display: "—", year: 2026 });
    expect(s.delta.tone).toBe("missing");
    expect(s.action?.amountEditable).toBe(true);
    expect(s.action?.defaultAmount).toBe(85_000);
    expect(s.action?.label).toMatch(/\$85,000/);
    expect(s.action?.describe).toMatch(/\$85,000/);
  });

  it("updates a matched business income row that differs (5% / $500), and checks one in line", () => {
    const f = emptyTaxReturnFacts(2025); f.businesses = [schedC("Dans Consulting", 85_000)];
    const plan = planFixture({ incomes: [biz("b1", "Dan's Consulting LLC", 60_000)] });
    const s = businessRules(inputFixture({ facts: f, plan })).suggestions[0];
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "b1", patch: { annualAmount: 85_000, inflationStartYear: 2025 } });
    // Both figures on the card, so a return/plan swap cannot pass, and ordered so an exchanged
    // interpolation reddens while the prose stays untouched.
    expect(s.returnFigure.amount).toBe(85_000);
    expect(s.planFigure).toMatchObject({ label: "Dan's Consulting LLC", amount: 60_000, display: "$60,000" });
    expect(s.delta.tone).toBe("short");
    expect(s.headline).toMatch(/\$85,000[\s\S]*\$60,000/);
    expect(s.action?.label).toMatch(/\$85,000/);
    const inline = businessRules(inputFixture({ facts: f, plan: planFixture({ incomes: [biz("b1", "Dan's Consulting LLC", 84_000)] }) }));
    expect(inline.suggestions).toEqual([]);
    expect(inline.checks[0].id).toBe("business.scheduleC.0");
    // $1,000 apart clears the $500 floor but not 5% of $85,000, so this is the leg that separates
    // "in line" from a write — and the pair is printed return-first.
    expect(inline.checks).toEqual([{ id: "business.scheduleC.0", label: "Dans Consulting", returnDisplay: "$85,000", planDisplay: "$84,000" }]);
  });

  it("creates the income ON a matching business account, and reviews an entity-only match", () => {
    const f = emptyTaxReturnFacts(2025); f.businesses = [schedC("Northwind", 40_000), schedC("Southwind", 20_000)];
    const plan = planFixture({
      accounts: [{ id: "acct-nw", name: "Northwind LLC", category: "business", subType: "llc" }],
      entities: [{ id: "ent-sw", name: "Southwind Partners", entityType: "partnership", taxTreatment: "ordinary" }],
    });
    const r = businessRules(inputFixture({ facts: f, plan }));
    expect(r.suggestions[0].action?.target).toMatchObject({ kind: "income.create", input: { ownerAccountId: "acct-nw", name: "Northwind" } });
    expect(r.suggestions[1]).toMatchObject({ id: "business.scheduleC.1", kind: "review" });
    expect(r.suggestions[1].meaning).toMatch(/reaches the household/);
    // The whole target, not just the two fields above: Northwind's own $40,000 has to be the amount
    // on Northwind's account. Reading Southwind's $20,000 onto it would pass a two-field check.
    expect(r.suggestions[0].action?.target).toEqual({ kind: "income.create", amountField: "annualAmount",
      input: { type: "business", name: "Northwind", owner: "client", annualAmount: 40_000, growthRate: 0.03, inflationStartYear: 2025, startYear: 2026, endYear: 2060, ownerAccountId: "acct-nw" } });
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "Northwind LLC", amount: null, display: "—" });
    // `namesMatch("Southwind", "Northwind")` is TRUE — two substitutions apart, inside the matcher's
    // 2-edit tolerance. The only thing keeping Southwind's income off the Northwind account is that
    // Northwind claimed it first, so this pins candidate ORDER, not just the predicate.
    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions[1].action).toBeUndefined();
    expect(r.suggestions[1].returnFigure.amount).toBe(20_000);
    expect(r.suggestions[1].planFigure).toMatchObject({ label: "Southwind Partners", amount: 0, display: "$0" });
    expect(r.suggestions[1].headline).toMatch(/\$20,000/);
    expect(r.suggestions[1].link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);
  });

  it("skips an unmatched loss and never offers one row to two businesses", () => {
    const f = emptyTaxReturnFacts(2025); f.businesses = [schedC("Acme", 50_000), schedC("Acme Two", 10_000), schedC("Dud", -5_000)];
    const plan = planFixture({ incomes: [biz("b1", "Acme", 50_000)] });
    const r = businessRules(inputFixture({ facts: f, plan }));
    expect(r.suggestions.map((s) => s.id)).toEqual(["business.scheduleC.1"]); // create for Acme Two; Acme checked; Dud skipped
    expect(r.suggestions[0].action?.target).toMatchObject({ kind: "income.create" });
    // "Acme Two" also matches the "Acme" row by containment, so the row being claimed is the only
    // thing sending it to the create arm with its own $10,000 rather than a write onto b1.
    expect(r.suggestions[0].action?.target).toMatchObject({ kind: "income.create", input: { name: "Acme Two", annualAmount: 10_000 } });
    expect(r.checks).toEqual([{ id: "business.scheduleC.0", label: "Acme", returnDisplay: "$50,000", planDisplay: "$50,000" }]);
  });

  it("says nothing about a business that lost money even when the plan carries it as an entity", () => {
    // `makeDelta` tones a negative return figure against an absent plan row as "Plan is $5,000
    // over" — copy that reads as the plan being too generous when the business simply lost money.
    const f = emptyTaxReturnFacts(2025); f.businesses = [schedC("Southwind", -5_000)];
    const plan = planFixture({ entities: [{ id: "ent-sw", name: "Southwind Partners", entityType: "partnership", taxTreatment: "ordinary" }] });
    expect(businessRules(inputFixture({ facts: f, plan }))).toEqual({ suggestions: [], checks: [] });
    // A loss the plan carries as an income ROW is still flagged: that row is real and it is wrong,
    // and here the delta genuinely is the plan being over.
    const withRow = planFixture({ incomes: [biz("b1", "Southwind", 20_000)] });
    const s = businessRules(inputFixture({ facts: f, plan: withRow })).suggestions[0];
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "b1", patch: { annualAmount: -5_000 } });
    expect(s.returnFigure.display).toBe("-$5,000");
    expect(s.planFigure).toMatchObject({ amount: 20_000, display: "$20,000" });
    expect(s.delta.tone).toBe("over");
  });

  it("ignores a salary row of the same name and a business row that has already ended", () => {
    const f = emptyTaxReturnFacts(2025); f.businesses = [schedC("Acme", 50_000)];
    const plan = planFixture({ incomes: [
      income({ id: "s1", type: "salary", name: "Acme", annualAmount: 50_000, growthRate: 0, inflationStartYear: 2025 }),
      biz("b0", "Acme", 50_000, { startYear: 2015, endYear: 2020 }),
    ] });
    const r = businessRules(inputFixture({ facts: f, plan }));
    expect(r.checks).toEqual([]);
    expect(r.suggestions.map((s) => s.id)).toEqual(["business.scheduleC.0"]);
    expect(r.suggestions[0].action?.target).toMatchObject({ kind: "income.create", input: { name: "Acme", annualAmount: 50_000 } });
  });
});

describe("businessRules — K-1", () => {
  it("creates the income (name suffixed), the entity, and nothing for QBI when the entity is new", () => {
    const f = emptyTaxReturnFacts(2025);
    f.k1s = [k1("Blue Harbor Partners", { entityType: "partnership", ordinaryBusinessIncome: 30_000, guaranteedPayments: 20_000, rentalIncome: null, qbiIncome: 25_000 })];
    const r = businessRules(inputFixture({ facts: f }));
    expect(r.suggestions.map((s) => s.id)).toEqual(["business.k1.0.income", "business.k1.0.entity"]);
    expect(r.suggestions[0].action?.target).toMatchObject({ kind: "income.create", input: { name: "Blue Harbor Partners (K-1)", annualAmount: 50_000 } });
    expect(r.suggestions[1].action?.target).toEqual({ kind: "entity.create", input: { name: "Blue Harbor Partners", entityType: "partnership", taxTreatment: "qbi", value: 0 } });
    // The income is boxes 1 + 4 + 2, and each box has to land on its own line ref: swapping the
    // ordinary-income and guaranteed-payment amounts leaves the $50,000 total untouched.
    expect(r.suggestions[0].returnFigure.lineRefs).toEqual([
      { form: "K-1", line: "1", label: "Blue Harbor Partners ordinary income", amount: 30_000 },
      { form: "K-1", line: "4", label: "Guaranteed payments", amount: 20_000 },
      { form: "K-1", line: "2", label: "Rental income", amount: null },
    ]);
    expect(r.suggestions[0].action?.target).toEqual({ kind: "income.create", amountField: "annualAmount",
      input: { type: "business", name: "Blue Harbor Partners (K-1)", owner: "client", annualAmount: 50_000, growthRate: 0.03, inflationStartYear: 2025, startYear: 2026, endYear: 2060 } });
    expect(r.suggestions[0].delta.tone).toBe("missing");
    // The entity card carries no dollar figure — it adds the interest at $0 — so its delta says so
    // rather than printing a number the card never shows.
    expect(r.suggestions[1].delta).toEqual({ amount: null, display: "Not in the plan", tone: "missing" });
    expect(r.suggestions[1].action?.amountEditable).toBe(false);
    expect(r.suggestions[1].action?.label).toMatch(/Blue Harbor Partners/);
    expect(r.checks).toEqual([]);
  });

  it("flags QBI treatment on an existing ordinary entity and does not create an estate/trust entity", () => {
    const f = emptyTaxReturnFacts(2025);
    f.k1s = [k1("Blue Harbor Partners", { entityType: "partnership", ordinaryBusinessIncome: 30_000, qbiIncome: 25_000 }), k1("Family Trust", { entityType: "estate_trust", ordinaryBusinessIncome: 5_000 })];
    const plan = planFixture({ entities: [{ id: "e1", name: "Blue Harbor Partners LP", entityType: "partnership", taxTreatment: "ordinary" }], incomes: [biz("b1", "Blue Harbor Partners (K-1)", 30_000)] });
    const r = businessRules(inputFixture({ facts: f, plan }));
    // The entity-type filter sits on the `.entity` row ONLY: creating a balance-sheet entity is
    // gated on an S-corp or a partnership, but `business.k1.<n>.income` carries no such gate and
    // matches the way Schedule C does. So the trust's $5,000 still earns an income row — what it
    // must not earn is an ENTITY, which is what this test is named for.
    expect(r.suggestions.map((s) => s.id)).toEqual(["business.k1.1.income", "business.k1.0.qbi"]);
    const qbi = r.suggestions.find((s) => s.id === "business.k1.0.qbi")!;
    expect(qbi.action?.target).toEqual({ kind: "entity.update", entityId: "e1", patch: { taxTreatment: "qbi" } });
    expect(r.suggestions[0].action?.target).toMatchObject({ kind: "income.create", input: { name: "Family Trust (K-1)", annualAmount: 5_000 } });
    expect(qbi.returnFigure).toMatchObject({ amount: 25_000, display: "$25,000" });
    expect(qbi.planFigure).toMatchObject({ label: "Blue Harbor Partners LP tax treatment", amount: null, display: "Ordinary" });
    expect(qbi.delta).toEqual({ amount: null, display: "Differs", tone: "neutral" });
    expect(qbi.meaning).toMatch(/\$25,000/);
    // The matched K-1 income is in line, and the check prints the return first.
    expect(r.checks).toEqual([{ id: "business.k1.0.income", label: "Blue Harbor Partners", returnDisplay: "$30,000", planDisplay: "$30,000" }]);
  });

  it("does not repeat the QBI flag when the entity is already marked QBI", () => {
    const f = emptyTaxReturnFacts(2025);
    f.k1s = [k1("Blue Harbor Partners", { entityType: "partnership", ordinaryBusinessIncome: 30_000, qbiIncome: 25_000 })];
    const plan = planFixture({
      entities: [{ id: "e1", name: "Blue Harbor Partners LP", entityType: "partnership", taxTreatment: "qbi" }],
      incomes: [biz("b1", "Blue Harbor Partners (K-1)", 30_000)],
    });
    expect(businessRules(inputFixture({ facts: f, plan })).suggestions).toEqual([]);
  });
});
