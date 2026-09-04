import { describe, it, expect } from "vitest";
import { emptyScheduleE, emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { rentalRules } from "../rules/rental";
import { CLIENT_ID, income, inputFixture, planFixture } from "./fixtures";

const factsWith = (net: number, depreciation: number | null) => {
  const f = emptyTaxReturnFacts(2025); f.income.scheduleENet = net;
  f.income.scheduleE = { ...emptyScheduleE(), grossRents: 19_600, depreciation }; return f;
};
const rentalAcct = (id: string, name: string) => ({ id, name, category: "real_estate", subType: "rental_property" });

describe("rentalRules — cash figure = scheduleENet + depreciation", () => {
  it("creates a linked rental income when one rental property exists and no row does", () => {
    const plan = planFixture({ accounts: [rentalAcct("re1", "12 Oak St")] });
    const s = rentalRules(inputFixture({ facts: factsWith(-6_141, 8_413), plan })).suggestions[0];
    // The create arm carries a dismissal id of its own: dismissing "add rental income" must not
    // also suppress "the rental amount is off", and these ids are persisted.
    expect(s.id).toBe("income.rental.create");
    expect(s.returnFigure.amount).toBe(2_272);
    expect(s.action?.target).toMatchObject({ kind: "income.create", input: { type: "other", name: "Rental income — 12 Oak St", linkedPropertyId: "re1", annualAmount: 2_272, inflationStartYear: 2025 } });
    expect(s.meaning).toMatch(/depreciation/i);
    // The two halves of the cash figure, each on its own line ref: a paper LOSS of $6,141 plus
    // $8,413 of depreciation is $2,272 of real cash. Swapping them would still total $2,272.
    expect(s.returnFigure.lineRefs).toEqual([
      { form: "Sched 1", line: "5", label: "Rental net", amount: -6_141 },
      { form: "Sched E", line: "18", label: "Depreciation", amount: 8_413 },
    ]);
    expect(s.action?.target).toEqual({ kind: "income.create", amountField: "annualAmount", ownerField: "owner",
      input: { type: "other", name: "Rental income — 12 Oak St", owner: "client", annualAmount: 2_272, growthRate: 0.03, inflationStartYear: 2025, startYear: 2026, endYear: 2060, linkedPropertyId: "re1" } });
    // Schedule E carries no taxpayer/spouse indicator, and ownership drives survivor modelling.
    expect(s.action?.ownerChoices).toEqual(["client", "spouse"]);
    expect(s.meaning).toMatch(/pick the owner first/);
    expect(s.planFigure).toMatchObject({ label: "Rental income in the plan", amount: null, display: "—", year: 2026 });
    expect(s.delta.tone).toBe("missing");
    expect(s.action?.defaultAmount).toBe(2_272);
    expect(s.action?.label).toMatch(/\$2,272/);
    expect(s.headline).toMatch(/12 Oak St[\s\S]*\$2,272/);
  });

  it("creates an unlinked row with several properties, reviews with none, updates one row, reviews two", () => {
    // $4,000 of net plus $8,000 of depreciation is $12,000 of cash in every arm below; only the
    // plan side changes.
    const card = (plan?: ReturnType<typeof planFixture>) => rentalRules(inputFixture({ facts: factsWith(4_000, 8_000), ...(plan ? { plan } : {}) })).suggestions[0];
    const one = planFixture({ incomes: [income({ id: "r1", type: "other", name: "Rent — Oak", annualAmount: 9_000, growthRate: 0, inflationStartYear: 2025, linkedPropertyId: "re1" })] });
    const two = planFixture({ incomes: [income({ id: "r1", type: "other", name: "Rental A", annualAmount: 5_000 }), income({ id: "r2", type: "other", name: "Rental B", annualAmount: 5_000 })] });

    const many = card(planFixture({ accounts: [rentalAcct("re1", "A"), rentalAcct("re2", "B")] }));
    expect(many.action?.target).toMatchObject({ input: { name: "Rental income (from 2025 return)" } });
    expect((many.action!.target as { input: Record<string, unknown> }).input.linkedPropertyId).toBeUndefined();
    // The return does not split by property, so the row carries the whole $12,000 and no link.
    expect(many.action?.target).toMatchObject({ kind: "income.create", input: { annualAmount: 12_000 } });
    expect(many.headline).toMatch(/\$12,000/);

    // No property at all: nothing to write against, so this is a review with a link, not a button.
    const none = card();
    expect(none.kind).toBe("review");
    expect(none.action).toBeUndefined();
    expect(none.link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);
    expect(none.headline).toMatch(/\$12,000/);

    // One row: both figures on the card, return first, and the write lands on that row.
    const single = card(one);
    expect(single.action?.target).toMatchObject({ kind: "income.update", incomeId: "r1", patch: { annualAmount: 12_000, inflationStartYear: 2025 }, amountField: "annualAmount" });
    expect(single.returnFigure.amount).toBe(12_000);
    expect(single.planFigure).toMatchObject({ label: "Rent — Oak", amount: 9_000, display: "$9,000" });
    expect(single.delta.tone).toBe("short");
    expect(single.headline).toMatch(/\$12,000[\s\S]*\$9,000/);

    // Two rows: Schedule E is one total across every property, so there is nothing to write.
    // $5,000 apiece in 2026 dollars is $9,709 in 2025 dollars at the fixture's 3% growth.
    const pair = card(two);
    expect(pair.kind).toBe("review");
    expect(pair.action).toBeUndefined();
    expect(pair.planFigure.amount).toBeCloseTo(9_708.74, 2);
    expect(pair.headline).toMatch(/2 rental rows/);
    expect(pair.headline).toMatch(/\$12,000[\s\S]*\$9,709/);
    expect(pair.link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);
  });

  it("stays silent when gross rents were extracted but Schedule 1 line 5 was missed", () => {
    // Both fields are independently nullable. Opening the rule on gross rents alone coerces the
    // unknown net to 0, so `cash` is $0 and the plan's live rental row is offered a one-click write
    // to zero under "Rental cash flow on the return is $0" — the exact case `differs`' own null
    // guard exists to prevent.
    const f = emptyTaxReturnFacts(2025);
    f.income.scheduleE = { ...emptyScheduleE(), grossRents: 19_600, depreciation: null };
    const plan = planFixture({
      accounts: [rentalAcct("re1", "12 Oak St")],
      incomes: [income({ id: "r1", type: "other", name: "Rent — Oak", annualAmount: 9_000, growthRate: 0, inflationStartYear: 2025, linkedPropertyId: "re1" })],
    });
    expect(rentalRules(inputFixture({ facts: f, plan }))).toEqual({ suggestions: [], checks: [] });
  });

  it("does not offer to restart a rental the plan models as ending in the tax year", () => {
    // The row ran THROUGH 2025 and stops before the 2026 plan year. It is invisible to the plan-year
    // aggregate by design, so without this the $12,000 falls to the create arm and offers to add the
    // rental back from 2026 to 2060 — beside a property that is already in the plan.
    const plan = planFixture({
      accounts: [rentalAcct("re1", "12 Oak St")],
      incomes: [income({ id: "r1", type: "other", name: "Rent — Oak", annualAmount: 12_000, growthRate: 0, inflationStartYear: 2025, linkedPropertyId: "re1", startYear: 2015, endYear: 2025 })],
    });
    const r = rentalRules(inputFixture({ facts: factsWith(4_000, 8_000), plan }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "income.rental", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].headline).toMatch(/Rent — Oak[\s\S]*2025[\s\S]*2026/);
    expect(r.suggestions[0].headline).toMatch(/\$12,000/);
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "Rent — Oak", amount: 0, display: "$0", year: 2026 });
    expect(r.suggestions[0].link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);
    expect(r.checks).toEqual([]);
  });

  it("does not offer a second rental row alongside one the plan starts later", () => {
    // The mirror-image gap to the ending case, and the harmful one: a row that starts AFTER the plan
    // year is in neither the plan-year aggregate nor the ending set, so the $12,000 falls to the
    // create arm — and the new 2026-2060 row would then pay the rent TWICE from 2030 on.
    const plan = planFixture({
      accounts: [rentalAcct("re1", "12 Oak St")],
      incomes: [income({ id: "r1", type: "other", name: "Rent — Oak", annualAmount: 12_000, growthRate: 0, inflationStartYear: 2025, linkedPropertyId: "re1", startYear: 2030, endYear: 2060 })],
    });
    const r = rentalRules(inputFixture({ facts: factsWith(4_000, 8_000), plan }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "income.rental", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].headline).toMatch(/Rent — Oak[\s\S]*2030/);
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "Rent — Oak", amount: 0, display: "$0", year: 2026 });
    expect(r.checks).toEqual([]);
    // The predicate is asymmetric on purpose: a row that ended long BEFORE the tax year can never
    // double up, so the create still stands for it.
    const old = planFixture({
      accounts: [rentalAcct("re1", "12 Oak St")],
      incomes: [income({ id: "r0", type: "other", name: "Rent — Oak", annualAmount: 12_000, growthRate: 0, inflationStartYear: 2025, linkedPropertyId: "re1", startYear: 2010, endYear: 2015 })],
    });
    expect(rentalRules(inputFixture({ facts: factsWith(4_000, 8_000), plan: old })).suggestions[0]).toMatchObject({ id: "income.rental.create", kind: "update" });
  });

  it("offers no owner choice on a created rental for a single filer", () => {
    const plan = planFixture({ client: { filingStatus: "single", dateOfBirth: "1960-04-02", spouseDob: null }, familyMembers: [], accounts: [rentalAcct("re1", "12 Oak St")] });
    const s = rentalRules(inputFixture({ facts: factsWith(4_000, 8_000), plan })).suggestions[0];
    expect(s.action?.ownerChoices).toBeUndefined();
    expect(s.meaning).not.toMatch(/pick the owner first/);
    expect(s.action?.target).toMatchObject({ kind: "income.create", ownerField: "owner", input: { owner: "client" } });
  });

  it("is silent with no Schedule E and checks when in line", () => {
    expect(rentalRules(inputFixture())).toEqual({ suggestions: [], checks: [] });
    const one = planFixture({ incomes: [income({ id: "r1", type: "other", name: "Rent", annualAmount: 12_100, growthRate: 0, inflationStartYear: 2025, linkedPropertyId: "re1" })] });
    const r = rentalRules(inputFixture({ facts: factsWith(4_000, 8_000), plan: one }));
    expect(r.checks[0].id).toBe("income.rental");
    // $100 apart is inside the $500 floor. The pair is printed return first, so a swap reddens.
    expect(r.suggestions).toEqual([]);
    expect(r.checks).toEqual([{ id: "income.rental", label: "Rental income", returnDisplay: "$12,000", planDisplay: "$12,100" }]);
  });
});
