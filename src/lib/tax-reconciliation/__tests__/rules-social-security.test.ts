import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { socialSecurityRules } from "../rules/social-security";
import { CLIENT_ID, engineYearFixture, income, inputFixture, planFixture } from "./fixtures";
import type { ActionTarget, PlanIncome, Suggestion } from "../types";

// Mirrors the real seed in create-client.ts: $0 stated, 2% growth, pia_at_fra, claimingAge 67.
// `over` is typed, not `{}`: an untyped bag silently swallows a misspelled override, so a test could
// think it was pinning `startYear` while the row kept the fixture default.
const ss = (id: string, owner: "client" | "spouse", over: Partial<PlanIncome> = {}) =>
  income({ id, type: "social_security", name: `Social Security — ${owner}`, annualAmount: 0, owner, growthRate: 0.02, ssBenefitMode: "pia_at_fra", claimingAge: 67, ...over });
const factsWith = (gross: number | null) => { const f = emptyTaxReturnFacts(2025); f.income.ssBenefitsGross = gross; return f; };
// The engine states each row's benefit in PLAN-year dollars, keyed by the row's id.
const engineWith = (bySource: Record<string, number>) => engineYearFixture({ income: { ...engineYearFixture().income, bySource } });
// `typeof s.action.target` would be a type QUERY, and a query does not honour the `!` on the value
// expression — it is a strict-mode error on an optional `action`. Narrow ActionTarget instead.
const claim = (s: Suggestion) => s.action!.target as Extract<ActionTarget, { kind: "income.socialSecurity.claim" }>;

describe("socialSecurityRules", () => {
  it("claims the single seed row when the return shows benefits and the plan pays none", () => {
    const plan = planFixture({ client: { filingStatus: "single", dateOfBirth: "1958-03-01", spouseDob: null }, familyMembers: [], incomes: [ss("s1", "client", { startYear: 2026 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity");
    expect(s.action?.ownerChoices).toBeUndefined();
    expect(s.action?.target).toEqual({
      kind: "income.socialSecurity.claim", amount: 30_000,
      rows: [{ owner: "client", incomeId: "s1", patch: { ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge: 67, startYear: 2026, inflationStartYear: 2025 } }],
    });
    // Which side is which. The return figure is the benefit received; the plan figure is zero. A
    // swap would leave a card headlined "not in the plan yet" above a plan figure of $30,000.
    expect(s.kind).toBe("update");
    expect(s.returnFigure.amount).toBe(30_000);
    expect(s.returnFigure.lineRefs[0]).toMatchObject({ form: "1040", line: "6a", amount: 30_000 });
    expect(s.planFigure).toMatchObject({ amount: 0, display: "$0", year: 2026 });
    expect(s.delta.tone).toBe("missing");
    expect(s.action?.amountEditable).toBe(true);
    expect(s.action?.defaultAmount).toBe(30_000);
  });

  it("offers client / spouse / split when both seed rows exist", () => {
    const plan = planFixture({ incomes: [ss("s1", "client"), ss("s2", "spouse")] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(62_000), plan })).suggestions[0];
    expect(s.action?.ownerChoices).toEqual(["client", "spouse", "split"]);
    const t = claim(s);
    expect(t.rows.map((r) => [r.owner, r.incomeId, r.patch.claimingAge])).toEqual([["client", "s1", 65], ["spouse", "s2", 63]]);
    // The two ages differ, so that triple is also the wrong-row guard: each patch has to read ITS
    // OWN owner's date of birth. Swapping client and spouse anywhere flips it to [63, 65].
    expect(t.amount).toBe(62_000);
    expect(s.meaning).toMatch(/choose who receives it/);
  });

  it("sends the advisor to Inflows & Outflows when there is no SS row at all", () => {
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan: planFixture() })).suggestions[0];
    expect(s.kind).toBe("review");
    expect(s.id).toBe("income.socialSecurity");
    expect(s.action).toBeUndefined(); // there is no row to write to
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/income-expenses`);
    expect(s.returnFigure.amount).toBe(30_000);
    expect(s.planFigure.amount).toBe(0);
  });

  it("updates the amount on one active row (5% / $500) and deflates by the row's growth", () => {
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 40_000 })] });
    const engineYear = engineWith({ s1: 40_800 }); // 40,000 × 1.02
    const r = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan, engineYear }));
    const s = r.suggestions.find((x) => x.id === "income.socialSecurity.amount")!;
    expect(s.planFigure.amount).toBeCloseTo(40_000, 0);
    expect(s.action?.target).toEqual({ kind: "income.update", incomeId: "s1", patch: { ssBenefitMode: "manual_amount", annualAmount: 30_000, inflationStartYear: 2025 }, amountField: "annualAmount" });
    // The row grows at 2%; the PLAN inflates at 3%. Deflating by the plan's rate would give $39,612,
    // so the assertion above is what separates "the row's own growth" from "the plan's inflation".
    expect(s.returnFigure.amount).toBe(30_000);
    expect(s.planFigure.label).toBe("Social Security — client");
    expect(s.delta.tone).toBe("over"); // the plan pays more than the return reports
    expect(r.checks).toEqual([]);
  });

  it("is in line inside tolerance, reviews a two-row total, and reports plan-only benefits as info", () => {
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 30_000 })] });
    const inline = socialSecurityRules(inputFixture({ facts: factsWith(30_500), plan, engineYear: engineWith({ s1: 30_600 }) }));
    expect(inline.suggestions).toEqual([]);
    expect(inline.checks[0].id).toBe("income.socialSecurity");
    // A $500 gap against the $500 floor. `differs` is strictly greater-than, so this is in line on
    // purpose — it is the boundary, not a rounding accident.
    expect(inline.checks).toEqual([{ id: "income.socialSecurity", label: "Social Security", returnDisplay: "$30,500", planDisplay: "$30,000" }]);

    const two = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 20_000 }), ss("s2", "spouse", { ssBenefitMode: "manual_amount", annualAmount: 20_000 })] });
    const split = socialSecurityRules(inputFixture({ facts: factsWith(62_000), plan: two, engineYear: engineWith({ s1: 20_400, s2: 20_400 }) }));
    expect(split.suggestions[0]).toMatchObject({ id: "income.socialSecurity.split", kind: "review" });
    expect(split.suggestions[0].returnFigure.amount).toBe(62_000);
    expect(split.suggestions[0].planFigure).toMatchObject({ label: "Social Security (both)" });
    expect(split.suggestions[0].planFigure.amount).toBeCloseTo(40_000, 0); // 20,400 + 20,400, deflated
    expect(split.suggestions[0].action).toBeUndefined(); // line 6a cannot say which row is off
    expect(split.checks).toEqual([]);

    const planOnly = socialSecurityRules(inputFixture({ facts: factsWith(null), plan, engineYear: engineWith({ s1: 30_600 }) }));
    expect(planOnly.suggestions[0]).toMatchObject({ id: "income.socialSecurity.planOnly", kind: "info" });
    expect(planOnly.suggestions[0].returnFigure).toMatchObject({ amount: null, display: "—" });
    expect(planOnly.suggestions[0].planFigure.amount).toBeCloseTo(30_000, 0);
    expect(planOnly.suggestions[0].delta.tone).toBe("extra");
    expect(planOnly.suggestions[0].action).toBeUndefined();
  });

  it("pulls a not-yet-started row's start back to the plan start and leaves an earlier start alone", () => {
    // Math.min in the claim patch, exercised in BOTH directions against a 2026 plan start: the row
    // seeded in 2024 keeps 2024, and the row that does not begin until 2030 is pulled back to 2026
    // — which is what makes the benefit actually pay once the claim is applied.
    const plan = planFixture({ incomes: [ss("s1", "client", { startYear: 2024 }), ss("s2", "spouse", { startYear: 2030 })] });
    const t = claim(socialSecurityRules(inputFixture({ facts: factsWith(62_000), plan })).suggestions[0]);
    expect(t.rows).toEqual([
      { owner: "client", incomeId: "s1", patch: { ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge: 65, startYear: 2024, inflationStartYear: 2025 } },
      { owner: "spouse", incomeId: "s2", patch: { ssBenefitMode: "manual_amount", claimingAgeMode: "years", claimingAge: 63, startYear: 2026, inflationStartYear: 2025 } },
    ]);
  });

  it("takes the plan figure from the engine, not from the row's own stated amount", () => {
    // The row states $99,000 a year but the engine pays $40,800 in 2026 — the orchestrator resolves
    // a claiming age the row's own fields cannot express. Reading the row would print $97,059.
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 99_000 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan, engineYear: engineWith({ s1: 40_800 }) })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity.amount");
    expect(s.planFigure.amount).toBeCloseTo(40_000, 0);
  });

  it("without an engine run, reads the row's growth branch and still states it in tax-year dollars", () => {
    // The row is active because it states an amount, and $40,800 in the 2026 plan year is $40,000 in
    // 2025 dollars at the row's own 2% growth.
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 40_800 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity.amount");
    expect(s.planFigure.amount).toBeCloseTo(40_000, 0);
    expect(s.action?.target).toMatchObject({ kind: "income.update", incomeId: "s1" });
  });

  it("treats a PIA-only row as paying, even though it can only report $0 for it", () => {
    // A `pia_at_fra` row states no annual amount — the benefit orchestrator resolves it and this
    // module's growth branch cannot (see rowAmountInYear's own comment). With no engine run the plan
    // figure is therefore $0. That is a known limitation, but the row still counts as active, so the
    // advisor is offered the amount fix rather than a claim they have already made.
    const plan = planFixture({ incomes: [ss("s1", "client", { piaMonthly: 2_500 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity.amount");
    expect(s.planFigure.amount).toBe(0);
    expect(s.delta.tone).toBe("missing");
  });

  it("does not count a row that has already ended as paying in the plan year", () => {
    // $40,000 a year, but the row stopped in 2020. Without the activity test it would read as
    // active and the advisor would be offered an amount edit on a row that pays nothing.
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 40_000, startYear: 2015, endYear: 2020 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity");
    expect(s.planFigure.amount).toBe(0);
  });

  it("sums both rows for the check when the two-row total is in line", () => {
    const plan = planFixture({ incomes: [
      ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 20_000 }),
      ss("s2", "spouse", { ssBenefitMode: "manual_amount", annualAmount: 10_000 }),
    ] });
    const r = socialSecurityRules(inputFixture({ facts: factsWith(30_400), plan, engineYear: engineWith({ s1: 20_400, s2: 10_200 }) }));
    expect(r.suggestions).toEqual([]);
    expect(r.checks).toEqual([{ id: "income.socialSecurity", label: "Social Security", returnDisplay: "$30,400", planDisplay: "$30,000" }]);
  });

  it("uses the 5% leg of the row tolerance, not a looser one", () => {
    // $20,000 against $18,500: a $1,500 gap, over the $500 floor and over 5% of the return ($1,000)
    // but under 10% ($2,000). Only the ROW tolerance flags it, so this is what separates ROW from
    // the looser W-2 and flow tolerances that sit beside it in compare.ts.
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 18_500 })] });
    const r = socialSecurityRules(inputFixture({ facts: factsWith(20_000), plan, engineYear: engineWith({ s1: 18_870 }) }));
    expect(r.suggestions[0]?.id).toBe("income.socialSecurity.amount");
    expect(r.checks).toEqual([]);
  });

  it("leaves a jointly-owned benefit out of the claim and offers no split for it", () => {
    // Social Security is always one person's award, and `apply.ts` writes the amount by owner. A row
    // owned "joint" has no owner to write to, so it is not a claimable row and its presence must not
    // turn a one-person claim into a client / spouse / split choice.
    const joint = income({ id: "s2", type: "social_security", name: "Social Security — joint", annualAmount: 0, owner: "joint", growthRate: 0.02, ssBenefitMode: "pia_at_fra", claimingAge: 67 });
    const plan = planFixture({ incomes: [ss("s1", "client"), joint] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan })).suggestions[0];
    expect(s.action?.ownerChoices).toBeUndefined();
    expect(claim(s).rows.map((r) => r.incomeId)).toEqual(["s1"]);
  });

  it("says nothing at all when neither side has Social Security", () => {
    // Under the $500 gate with no active row: no suggestion and no check — there is nothing to
    // reconcile, and an "in line" row for two blanks would be noise. $500 itself is under the gate;
    // the gate is strictly greater-than.
    expect(socialSecurityRules(inputFixture({ facts: factsWith(400) }))).toEqual({ suggestions: [], checks: [] });
    expect(socialSecurityRules(inputFixture({ facts: factsWith(null) }))).toEqual({ suggestions: [], checks: [] });
    expect(socialSecurityRules(inputFixture({ facts: factsWith(500) }))).toEqual({ suggestions: [], checks: [] });
    expect(socialSecurityRules(inputFixture({ facts: factsWith(501) })).suggestions[0].id).toBe("income.socialSecurity");
  });
});
