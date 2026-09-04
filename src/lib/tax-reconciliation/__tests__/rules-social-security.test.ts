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
    // The button and its description name the figure they write. A label reading $40,000 over a
    // write of $30,000 is the failure these pin.
    expect(s.action?.label).toMatch(/\$30,000/);
    expect(s.action?.describe).toMatch(/\$30,000/);
    // Line 6a in the first year of benefits covers only the months received, so a write arm must
    // say so rather than call the return figure the award.
    expect(s.meaning).toMatch(/only the months received/);
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

  it("does not claim a spouse-owned row when there is no spouse date of birth", () => {
    // ageAtYearEnd returns null with no date of birth, and writing a null claimingAge into the row
    // would quietly erase the age already stated on it. The client row is still claimable, so this
    // must also not offer a client / spouse split the spouse row cannot take part in.
    const plan = planFixture({ client: { filingStatus: "married_joint", dateOfBirth: "1960-04-02", spouseDob: null }, incomes: [ss("s1", "client"), ss("s2", "spouse")] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(62_000), plan })).suggestions[0];
    expect(s.kind).toBe("update");
    expect(s.action?.ownerChoices).toBeUndefined();
    expect(claim(s).rows.map((r) => r.incomeId)).toEqual(["s1"]);
  });

  it("reviews rather than offering a write when the only row has no usable date of birth", () => {
    const plan = planFixture({ client: { filingStatus: "married_joint", dateOfBirth: "1960-04-02", spouseDob: null }, incomes: [ss("s1", "spouse")] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan })).suggestions[0];
    expect(s).toMatchObject({ id: "income.socialSecurity", kind: "review" });
    expect(s.action).toBeUndefined(); // a button that writes claimingAge: null must never ship
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/income-expenses`);
  });

  it("reviews rather than offering a write when every Social Security row is jointly owned", () => {
    // apply.ts writes the claimed amount by owner, so a joint row has no one to write to. All-joint
    // used to produce a normal-looking button carrying an empty rows array.
    const joint = income({ id: "s1", type: "social_security", name: "Social Security — joint", annualAmount: 0, owner: "joint", growthRate: 0.02, ssBenefitMode: "pia_at_fra", claimingAge: 67 });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan: planFixture({ incomes: [joint] }) })).suggestions[0];
    expect(s).toMatchObject({ id: "income.socialSecurity", kind: "review" });
    expect(s.action).toBeUndefined();
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
    // The headline interpolates the return's figure and then the plan's. Exchanging the two leaves
    // the prose intact and the card wrong, so the order is what this pins — not the wording.
    expect(s.headline).toMatch(/\$30,000[\s\S]*\$40,000/);
    expect(s.action?.label).toMatch(/\$30,000/);
    expect(s.action?.describe).toMatch(/\$30,000/);
    // Line 6a is the months received in the first benefit year, not the annual award. The copy has
    // to name that assumption, and must not assert the opposite.
    expect(s.meaning).toMatch(/only the months received/);
    expect(s.meaning).not.toMatch(/actual award/);
  });

  it("reviews rather than writes when the plan starts the benefit in the tax year", () => {
    // The plan itself says benefits begin in 2025, so line 6a is a part-year figure by construction
    // and cannot be written in as the yearly award. The return does not carry the claim month, so
    // there is nothing to annualise from — the advisor is asked instead of guessed at.
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 40_000, startYear: 2025 })] });
    const r = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan }));
    const s = r.suggestions[0];
    expect(s.id).toBe("income.socialSecurity.amount"); // same id, so a dismissal still corresponds
    expect(s.kind).toBe("review");
    expect(s.action).toBeUndefined();
    expect(s.link?.href).toBe(`/clients/${CLIENT_ID}/details/income-expenses`);
    expect(s.planFigure.amount).toBeCloseTo(40_000, 0);
    expect(s.headline).toMatch(/\$30,000[\s\S]*\$40,000/);
    expect(r.checks).toEqual([]);
  });

  it("says the plan's benefit is unknown, not zero, when a PIA row has no projection behind it", () => {
    // rowAmountInYear returns 0 for a pia_at_fra row by design — the benefit orchestrator resolves
    // it. With no engine year that $0 is an artifact of the missing projection, so the card must not
    // report it as the plan figure, and must not offer the one click that would rewrite a
    // PIA-driven row to a stated annual amount on the strength of it.
    const plan = planFixture({ incomes: [ss("s1", "client", { piaMonthly: 2_500 })] });
    const r = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan }));
    const s = r.suggestions[0];
    expect(s.kind).toBe("review");
    expect(s.action).toBeUndefined();
    expect(s.planFigure).toMatchObject({ amount: null, display: "—" });
    expect(s.delta.amount).toBeNull();
    expect(r.checks).toEqual([]); // no check either: there is no plan figure to call in line
    // With the projection in hand the same row reconciles normally.
    const withEngine = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan, engineYear: engineWith({ s1: 30_600 }) }));
    expect(withEngine.suggestions).toEqual([]);
    expect(withEngine.checks[0]).toMatchObject({ id: "income.socialSecurity.amount" });
  });

  it("is in line inside tolerance, reviews a two-row total, and reports plan-only benefits as info", () => {
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 30_000 })] });
    const inline = socialSecurityRules(inputFixture({ facts: factsWith(30_500), plan, engineYear: engineWith({ s1: 30_600 }) }));
    expect(inline.suggestions).toEqual([]);
    // The check carries the id the suggestion WOULD have carried on this arm, so dismissing the
    // `.amount` card and then bringing the figures into line cannot resurrect it under a new id.
    expect(inline.checks[0].id).toBe("income.socialSecurity.amount");
    // A $500 gap against the $500 floor. `differs` is strictly greater-than, so this is in line on
    // purpose — it is the boundary, not a rounding accident.
    expect(inline.checks).toEqual([{ id: "income.socialSecurity.amount", label: "Social Security", returnDisplay: "$30,500", planDisplay: "$30,000" }]);

    const two = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 20_000 }), ss("s2", "spouse", { ssBenefitMode: "manual_amount", annualAmount: 20_000 })] });
    const split = socialSecurityRules(inputFixture({ facts: factsWith(62_000), plan: two, engineYear: engineWith({ s1: 20_400, s2: 20_400 }) }));
    expect(split.suggestions[0]).toMatchObject({ id: "income.socialSecurity.split", kind: "review" });
    expect(split.suggestions[0].returnFigure.amount).toBe(62_000);
    expect(split.suggestions[0].planFigure).toMatchObject({ label: "Social Security (both)" });
    expect(split.suggestions[0].planFigure.amount).toBeCloseTo(40_000, 0); // 20,400 + 20,400, deflated
    expect(split.suggestions[0].action).toBeUndefined(); // line 6a cannot say which row is off
    expect(split.suggestions[0].headline).toMatch(/\$62,000[\s\S]*\$40,000/); // return first, then the plan
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

  it("treats a PIA-only row as paying rather than as an unclaimed seed", () => {
    // A `pia_at_fra` row states no annual amount, so it must still count as active — otherwise the
    // advisor is offered a claim they have already made. With the engine present the figure is real.
    const plan = planFixture({ incomes: [ss("s1", "client", { piaMonthly: 2_500 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan, engineYear: engineWith({ s1: 40_800 }) })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity.amount");
    expect(s.planFigure.amount).toBeCloseTo(40_000, 0);
    expect(s.delta.tone).toBe("over");
  });

  it("does not count a row that has already ended as paying in the plan year", () => {
    // $40,000 a year, but the row stopped in 2020. Without the activity test it would read as
    // active and the advisor would be offered an amount edit on a row that pays nothing.
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 40_000, startYear: 2015, endYear: 2020 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(30_000), plan })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity");
    expect(s.planFigure.amount).toBe(0);
    // The id and the $0 alone do NOT separate the two arms this row could land on — the claim arm
    // and the no-claimable-row review carry both. The claim patch sets startYear and never endYear,
    // so claiming an ended row writes into a benefit that still pays nothing: it has to be a review.
    expect(s.kind).toBe("review");
    expect(s.action).toBeUndefined();
  });

  it("sums both rows for the check when the two-row total is in line", () => {
    const plan = planFixture({ incomes: [
      ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 20_000 }),
      ss("s2", "spouse", { ssBenefitMode: "manual_amount", annualAmount: 10_000 }),
    ] });
    const r = socialSecurityRules(inputFixture({ facts: factsWith(30_400), plan, engineYear: engineWith({ s1: 20_400, s2: 10_200 }) }));
    expect(r.suggestions).toEqual([]);
    // The two-row arm's check carries the two-row arm's id, not the claim arm's.
    expect(r.checks).toEqual([{ id: "income.socialSecurity.split", label: "Social Security", returnDisplay: "$30,400", planDisplay: "$30,000" }]);
  });

  it("counts the benefits it is actually comparing in the split headline", () => {
    // Three rows, so a hardcoded "two benefits" prints a number the card is not showing.
    const plan = planFixture({ incomes: [
      ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 20_000 }),
      ss("s2", "spouse", { ssBenefitMode: "manual_amount", annualAmount: 20_000 }),
      ss("s3", "spouse", { ssBenefitMode: "manual_amount", annualAmount: 20_000 }),
    ] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(40_000), plan, engineYear: engineWith({ s1: 20_400, s2: 20_400, s3: 20_400 }) })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity.split");
    expect(s.headline).toMatch(/3 benefits/);
    expect(s.headline).toMatch(/\$40,000[\s\S]*\$60,000/);
  });

  it("names a small return figure on the plan-only card instead of calling it none", () => {
    // $300 is under the $500 gate, so this arm fires — but the card used to headline "shows none"
    // beside a delta built from $0, overstating the gap by the return's own figure.
    const plan = planFixture({ incomes: [ss("s1", "client", { ssBenefitMode: "manual_amount", annualAmount: 30_000 })] });
    const s = socialSecurityRules(inputFixture({ facts: factsWith(300), plan, engineYear: engineWith({ s1: 30_600 }) })).suggestions[0];
    expect(s.id).toBe("income.socialSecurity.planOnly");
    expect(s.headline).toMatch(/\$30,000[\s\S]*\$300\./); // the plan's figure, then the return's
    expect(s.headline).not.toMatch(/shows none/);
    expect(s.delta.tone).toBe("over");
    expect(s.delta.amount).toBeCloseTo(29_700, 0); // 30,000 − 300, not 30,000 − 0
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
