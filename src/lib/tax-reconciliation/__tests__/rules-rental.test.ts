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
    expect(s.id).toBe("income.rental");
    expect(s.returnFigure.amount).toBe(2_272);
    expect(s.action?.target).toMatchObject({ kind: "income.create", input: { type: "other", name: "Rental income — 12 Oak St", linkedPropertyId: "re1", annualAmount: 2_272, inflationStartYear: 2025 } });
    expect(s.meaning).toMatch(/depreciation/i);
    // The two halves of the cash figure, each on its own line ref: a paper LOSS of $6,141 plus
    // $8,413 of depreciation is $2,272 of real cash. Swapping them would still total $2,272.
    expect(s.returnFigure.lineRefs).toEqual([
      { form: "Sched 1", line: "5", label: "Rental net", amount: -6_141 },
      { form: "Sched E", line: "18", label: "Depreciation", amount: 8_413 },
    ]);
    expect(s.action?.target).toEqual({ kind: "income.create", amountField: "annualAmount",
      input: { type: "other", name: "Rental income — 12 Oak St", owner: "client", annualAmount: 2_272, growthRate: 0.03, inflationStartYear: 2025, startYear: 2026, endYear: 2060, linkedPropertyId: "re1" } });
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
