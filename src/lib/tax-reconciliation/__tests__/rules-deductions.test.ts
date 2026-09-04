import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, emptyScheduleA } from "@/lib/schemas/tax-return-facts";
import { deductionRules } from "../rules/deductions";
import { CLIENT_ID, engineYearFixture, inputFixture, planFixture } from "./fixtures";
import type { PlanDeduction } from "../types";

const factsWith = (a: Partial<ReturnType<typeof emptyScheduleA>>) => {
  const f = emptyTaxReturnFacts(2025);
  f.deductions.scheduleA = { ...emptyScheduleA(), ...a };
  return f;
};
const breakdown = (stateIncomeTax: number, propertyTaxes: number) => ({
  aboveLine: { retirementContributions: 0, taggedExpenses: 0, manualEntries: 0, studentLoanInterest: 0, total: 0, bySource: {} },
  belowLine: { charitable: 0, taxesPaid: 0, stateIncomeTax, propertyTaxes, interestPaid: 0, otherItemized: 0, itemizedTotal: 0, standardDeduction: 0, taxDeductions: 0, bySource: {} },
});
// `over` is typed, not `{}`: an untyped bag silently swallows a misspelled override, so a test could
// think it was pinning `endYear` while the row kept the default.
const gift = (id: string, name: string, annualAmount: number, over: Partial<PlanDeduction> = {}): PlanDeduction =>
  ({ id, type: "charitable", name, annualAmount, growthRate: 0, startYear: 2026, endYear: 2060, ...over });
const interest = (byLiability: Record<string, number>) =>
  engineYearFixture({ expenses: { ...engineYearFixture().expenses, interestByLiability: byLiability } });

describe("deductionRules — charitable (> $500; 5% / $500)", () => {
  it("creates a joint charitable deduction, updates one that differs, reviews many", () => {
    const create = deductionRules(inputFixture({ facts: factsWith({ charitableCash: 4_000, charitableNonCash: 1_000 }) })).suggestions[0];
    // The create arm carries a dismissal id of its own: dismissing "add this giving" must not also
    // suppress "this giving's amount is off", and these ids are persisted.
    expect(create.id).toBe("deductions.charitable.create");
    expect(create.action?.target).toEqual({ kind: "deduction.create", amountField: "annualAmount", input: { type: "charitable", name: "Charitable giving (from 2025 return)", owner: "joint", annualAmount: 5_000, growthRate: 0, startYear: 2026, endYear: 2060 } });
    // Cash + non-cash are one figure on the card, and the plan carries nothing at all.
    expect(create.returnFigure).toMatchObject({ label: "Charitable gifts", amount: 5_000, display: "$5,000" });
    expect(create.returnFigure.lineRefs[0]).toMatchObject({ form: "Sched A", line: "11–12" });
    expect(create.planFigure).toMatchObject({ label: "Charitable deductions in the plan", amount: null, display: "—", year: 2026 });
    expect(create.delta.tone).toBe("missing");
    expect(create.action).toMatchObject({ amountEditable: true, defaultAmount: 5_000 });
    expect(create.action?.label).toMatch(/\$5,000/);
    // Charitable giving is written jointly, so there is no owner for the advisor to pick.
    expect(create.action?.ownerChoices).toBeUndefined();

    const one = planFixture({ deductions: [gift("d1", "Church", 2_000)] });
    const update = deductionRules(inputFixture({ facts: factsWith({ charitableCash: 5_000 }), plan: one })).suggestions[0];
    expect(update.id).toBe("deductions.charitable");
    expect(update.action?.target).toEqual({ kind: "deduction.update", deductionId: "d1", patch: { annualAmount: 5_000 }, amountField: "annualAmount" });
    expect(update.returnFigure.amount).toBe(5_000);
    expect(update.planFigure).toMatchObject({ label: "Church", amount: 2_000, display: "$2,000", year: 2026 });
    expect(update.delta.tone).toBe("short");
    // Ordered, so exchanging the two interpolations reddens while the prose stays free.
    expect(update.headline).toMatch(/\$5,000[\s\S]*\$2,000/);
    expect(update.action?.label).toMatch(/\$5,000/);

    const many = planFixture({ deductions: [gift("d1", "A", 1_000), gift("d2", "B", 1_000)] });
    const review = deductionRules(inputFixture({ facts: factsWith({ charitableCash: 5_000 }), plan: many })).suggestions[0];
    expect(review).toMatchObject({ id: "deductions.charitable", kind: "review", link: { href: expect.stringMatching(/details\/deductions$/) } });
    expect(review.action).toBeUndefined();
    expect(review.returnFigure.amount).toBe(5_000);
    expect(review.planFigure).toMatchObject({ label: "Charitable deductions in the plan", amount: 2_000, display: "$2,000" });
    expect(review.headline).toMatch(/\$5,000[\s\S]*\$2,000/);
  });

  it("checks giving that is in line, ignores small giving, and grows the row from its own start year", () => {
    const inLine = deductionRules(inputFixture({ facts: factsWith({ charitableCash: 5_000 }), plan: planFixture({ deductions: [gift("d1", "Church", 4_900)] }) }));
    expect(inLine.suggestions).toEqual([]);
    // $100 apart is inside the $500 floor, so this is the leg that separates "in line" from a
    // write — and the pair is printed return-first, so a swap of the two reddens.
    expect(inLine.checks).toEqual([{ id: "deductions.charitable", label: "Charitable gifts", returnDisplay: "$5,000", planDisplay: "$4,900" }]);

    // $500 is the floor, not a threshold that fires: the return has to exceed it.
    expect(deductionRules(inputFixture({ facts: factsWith({ charitableCash: 500 }) }))).toEqual({ suggestions: [], checks: [] });
    // No Schedule A at all — it is nullable on a filed return that took the standard deduction.
    expect(deductionRules(inputFixture({ facts: emptyTaxReturnFacts(2025) }))).toEqual({ suggestions: [], checks: [] });

    // `client_deductions` has no inflation start year, so the engine grows a row from its own
    // startYear. A 2020 row at 10% is worth $10,000 × 1.1^5 in 2025 — not its face amount.
    const grown = planFixture({ deductions: [gift("d1", "Church", 10_000, { growthRate: 0.1, startYear: 2020 })] });
    const p = 10_000 * Math.pow(1.1, 5);
    expect(deductionRules(inputFixture({ facts: factsWith({ charitableCash: 16_105 }), plan: grown })).checks[0]).toMatchObject({ planDisplay: "$16,105" });
    expect(p).toBeCloseTo(16_105.1, 0);
  });

  it("does not offer to restart giving the plan models as ending", () => {
    // The harmful shape is a row that ran THROUGH the tax year and stops before the plan year — the
    // pledge the advisor deliberately modelled as finishing. Filtering to plan-year-active rows
    // makes it invisible, and the return's own $5,000 then falls through to the create arm and
    // offers to add the giving back from 2026 to 2060.
    const ended = planFixture({ deductions: [gift("d1", "Capital campaign", 5_000, { startYear: 2020, endYear: 2025 })] });
    const r = deductionRules(inputFixture({ facts: factsWith({ charitableCash: 5_000 }), plan: ended }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "deductions.charitable", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].headline).toMatch(/Capital campaign[\s\S]*2025[\s\S]*2026/);
    // An ended row must never be shown a money figure: the plan gives nothing in 2026, so $0 is the
    // honest plan figure and the prose says why.
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "Capital campaign", amount: 0, display: "$0", year: 2026 });
    expect(r.suggestions[0].link?.href).toBe(`/clients/${CLIENT_ID}/details/deductions`);
    expect(r.checks).toEqual([]);
  });
});

describe("deductionRules — SALT and mortgage interest (engine-level)", () => {
  it("reviews SALT when the return is more than double the plan and $2,000 apart, deflated", () => {
    const engineYear = engineYearFixture({ deductionBreakdown: breakdown(4_120, 4_120) }); // 8,240 in 2026 → 8,000 in 2025 dollars
    const r = deductionRules(inputFixture({ facts: factsWith({ saltPaid: 32_000 }), engineYear }));
    const s = r.suggestions.find((x) => x.id === "deductions.salt")!;
    expect(s.kind).toBe("review");
    expect(s.action).toBeUndefined();
    expect(s.planFigure.amount).toBeCloseTo(8_000, 0);
    expect(s.returnFigure).toMatchObject({ label: "State and local taxes paid", amount: 32_000, display: "$32,000" });
    expect(s.returnFigure.lineRefs[0]).toMatchObject({ form: "Sched A", line: "5d" });
    expect(s.planFigure).toMatchObject({ display: "$8,000", year: 2026 });
    expect(s.headline).toMatch(/\$32,000[\s\S]*\$8,000/);
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);

    // Under the "more than double" leg the pair is simply reported, return first.
    const near = deductionRules(inputFixture({ facts: factsWith({ saltPaid: 12_000 }), engineYear }));
    expect(near.suggestions.map((x) => x.id)).toEqual([]);
    expect(near.checks).toEqual([{ id: "deductions.salt", label: "State and local taxes", returnDisplay: "$12,000", planDisplay: "$8,000" }]);
    // State income tax and property tax are BOTH in the plan figure, each once. The two are
    // deliberately unequal here — $3,000 and $5,000 in 2025 dollars — so dropping either term, or
    // reading one of them twice, moves the total off $8,000.
    const asym = deductionRules(inputFixture({ facts: factsWith({ saltPaid: 6_000 }), engineYear: engineYearFixture({ deductionBreakdown: breakdown(3_090, 5_150) }) }));
    expect(asym.checks).toEqual([{ id: "deductions.salt", label: "State and local taxes", returnDisplay: "$6,000", planDisplay: "$8,000" }]);
  });

  it("reviews mortgage interest when the plan's liability interest is under half, and skips both without an engine year", () => {
    const engineYear = interest({ l1: 5_150 }); // 5,000 in 2025 dollars
    const s = deductionRules(inputFixture({ facts: factsWith({ mortgageInterest: 22_000 }), engineYear })).suggestions.find((x) => x.id === "deductions.mortgageInterest")!;
    expect(s).toMatchObject({ kind: "review", link: { href: expect.stringMatching(/net-worth$/) } });
    expect(s.action).toBeUndefined();
    expect(s.planFigure.amount).toBeCloseTo(5_000, 0);
    expect(s.returnFigure).toMatchObject({ label: "Mortgage interest", amount: 22_000, display: "$22,000" });
    expect(s.returnFigure.lineRefs[0]).toMatchObject({ form: "Sched A", line: "8a" });
    expect(s.planFigure).toMatchObject({ label: "Loan interest in the plan", display: "$5,000", year: 2026 });
    expect(s.headline).toMatch(/\$22,000[\s\S]*\$5,000/);

    // Every liability's interest counts, not just the first: one $5,150 loan reviews, two do not.
    const two = deductionRules(inputFixture({ facts: factsWith({ mortgageInterest: 22_000 }), engineYear: interest({ l1: 5_150, l2: 15_450 }) }));
    expect(two.suggestions.map((x) => x.id)).toEqual([]);
    expect(two.checks).toEqual([{ id: "deductions.mortgageInterest", label: "Mortgage interest", returnDisplay: "$22,000", planDisplay: "$20,000" }]);
    // Below the $1,000 floor there is nothing worth saying.
    expect(deductionRules(inputFixture({ facts: factsWith({ mortgageInterest: 900 }), engineYear }))).toEqual({ suggestions: [], checks: [] });

    const none = deductionRules(inputFixture({ facts: factsWith({ saltPaid: 32_000, mortgageInterest: 22_000 }) }));
    expect(none.suggestions.map((x) => x.id)).toEqual([]);
    expect(none.checks).toEqual([]);
  });
});
