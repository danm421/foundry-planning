import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, emptyAdjustmentsDetail } from "@/lib/schemas/tax-return-facts";
import { savingsRules } from "../rules/savings";
import { CLIENT_ID, inputFixture, planFixture } from "./fixtures";
import type { PlanAccount, PlanSavingsRule } from "../types";

const factsWith = (sep: number | null, hsa: number | null) => {
  const f = emptyTaxReturnFacts(2025);
  f.income.adjustmentsDetail = { ...emptyAdjustmentsDetail(), sepSimpleSolo401k: sep, hsaDeduction: hsa };
  return f;
};
const acct = (id: string, subType: string): PlanAccount => ({ id, name: `${subType} account`, category: "retirement", subType });
// `over` is typed, not `{}`: an untyped bag silently swallows a misspelled override, so a test could
// think it was pinning `endYear` while the rule kept the fixture default.
const rule = (id: string, accountId: string, amount: number, over: Partial<PlanSavingsRule> = {}): PlanSavingsRule =>
  ({ id, accountId, annualAmount: amount, startYear: 2026, endYear: 2060, ...over });

describe("savingsRules (5% / $500)", () => {
  it("creates a rule into the SEP account when none exists, and updates one that differs", () => {
    const create = savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: planFixture({ accounts: [acct("a1", "sep_ira")] }) })).suggestions[0];
    // The create arm carries a dismissal id of its own: dismissing "add this contribution" must not
    // also suppress "this contribution's amount is off", and these ids are persisted.
    expect(create.id).toBe("savings.sepSimple.create");
    expect(create.action?.target).toEqual({ kind: "savings_rule.create", amountField: "annualAmount", input: { accountId: "a1", annualAmount: 20_000, startYear: 2026, endYear: 2060, endYearRef: "client_retirement" } });
    // Which side is which: $20,000 is what the return deducts, and the plan saves nothing.
    expect(create.returnFigure).toMatchObject({ label: "SEP / SIMPLE / solo 401(k) deduction", amount: 20_000, display: "$20,000" });
    expect(create.planFigure).toMatchObject({ label: "Contributions to sep_ira account in the plan", amount: 0, display: "$0", year: 2026 });
    expect(create.delta.tone).toBe("missing");
    expect(create.headline).toMatch(/\$20,000[\s\S]*sep_ira account/);
    expect(create.action).toMatchObject({ amountEditable: true, defaultAmount: 20_000 });
    expect(create.action?.label).toMatch(/\$20,000/);
    expect(create.action?.describe).toMatch(/\$20,000[\s\S]*sep_ira account/);
    // A savings rule is a write on the ACCOUNT, which already carries its owner, so there is no
    // owner for the advisor to pick.
    expect(create.action?.ownerChoices).toBeUndefined();

    const update = savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: planFixture({ accounts: [acct("a1", "simple_ira")], savingsRules: [rule("r1", "a1", 12_000)] }) })).suggestions[0];
    expect(update.id).toBe("savings.sepSimple");
    expect(update.action?.target).toEqual({ kind: "savings_rule.update", ruleId: "r1", patch: { annualAmount: 20_000 }, amountField: "annualAmount" });
    expect(update.returnFigure.lineRefs[0]).toMatchObject({ form: "Sched 1", line: "16" });
    expect(update.returnFigure.amount).toBe(20_000);
    expect(update.planFigure).toMatchObject({ label: "Contributions to simple_ira account in the plan", amount: 12_000, display: "$12,000", year: 2026 });
    expect(update.delta.tone).toBe("short");
    // Ordered, so exchanging the two interpolations reddens while the prose stays free.
    expect(update.headline).toMatch(/\$20,000[\s\S]*\$12,000/);
    expect(update.action?.label).toMatch(/\$20,000/);
    expect(update.action).toMatchObject({ amountEditable: true, defaultAmount: 20_000 });
  });

  it("reviews when there is no such account, reviews two rules, checks in line, and handles HSA the same way", () => {
    const noAccount = savingsRules(inputFixture({ facts: factsWith(20_000, null) }));
    expect(noAccount.suggestions[0]).toMatchObject({ id: "savings.sepSimple", kind: "review", section: "savings" });
    expect(noAccount.suggestions[0].action).toBeUndefined();
    expect(noAccount.suggestions[0].link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);
    expect(noAccount.suggestions[0].returnFigure.amount).toBe(20_000);
    expect(noAccount.suggestions[0].planFigure).toMatchObject({ label: "No SEP or SIMPLE IRA in the plan", amount: null, display: "—", year: 2026 });
    expect(noAccount.checks).toEqual([]);

    const two = planFixture({ accounts: [acct("a1", "sep_ira")], savingsRules: [rule("r1", "a1", 5_000), rule("r2", "a1", 5_000)] });
    const many = savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: two })).suggestions[0];
    expect(many.kind).toBe("review");
    expect(many.id).toBe("savings.sepSimple");
    expect(many.action).toBeUndefined();
    expect(many.returnFigure.amount).toBe(20_000);
    expect(many.planFigure).toMatchObject({ amount: 10_000, display: "$10,000" });
    expect(many.headline).toMatch(/\$20,000[\s\S]*\$10,000/);

    const inline = planFixture({ accounts: [acct("a1", "sep_ira")], savingsRules: [rule("r1", "a1", 19_800)] });
    const inLine = savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: inline }));
    expect(inLine.suggestions).toEqual([]);
    // $200 apart is inside the $500 floor, so this is the leg that separates "in line" from a
    // write — and the pair is printed return-first, so a swap of the two reddens.
    expect(inLine.checks).toEqual([{ id: "savings.sepSimple", label: "SEP / SIMPLE / solo 401(k) deduction", returnDisplay: "$20,000", planDisplay: "$19,800" }]);

    const hsa = savingsRules(inputFixture({ facts: factsWith(null, 8_300), plan: planFixture({ accounts: [acct("h1", "hsa")] }) })).suggestions[0];
    expect(hsa.id).toBe("savings.hsa.create");
    expect(hsa.action?.target).toEqual({ kind: "savings_rule.create", amountField: "annualAmount", input: { accountId: "h1", annualAmount: 8_300, startYear: 2026, endYear: 2060, endYearRef: "client_retirement" } });
    expect(hsa.returnFigure.lineRefs[0]).toMatchObject({ form: "Sched 1", line: "13" });
    expect(hsa.returnFigure).toMatchObject({ label: "HSA deduction", amount: 8_300, display: "$8,300" });
  });

  it("reports both adjustments in one pass and says nothing when a line is blank or zero", () => {
    const both = savingsRules(inputFixture({ facts: factsWith(20_000, 8_300), plan: planFixture({ accounts: [acct("a1", "sep_ira"), acct("h1", "hsa")] }) }));
    expect(both.suggestions.map((s) => s.id)).toEqual(["savings.sepSimple.create", "savings.hsa.create"]);
    // Each line's own amount has to land on its own account: reading the SEP's $20,000 onto the
    // HSA would pass a kind-only check.
    expect(both.suggestions[0].action?.target).toMatchObject({ kind: "savings_rule.create", input: { accountId: "a1", annualAmount: 20_000 } });
    expect(both.suggestions[1].action?.target).toMatchObject({ kind: "savings_rule.create", input: { accountId: "h1", annualAmount: 8_300 } });

    expect(savingsRules(inputFixture({ facts: factsWith(null, null) }))).toEqual({ suggestions: [], checks: [] });
    expect(savingsRules(inputFixture({ facts: factsWith(0, 0) }))).toEqual({ suggestions: [], checks: [] });
    // No Schedule 1 detail at all — `adjustmentsDetail` is nullable on a filed return.
    expect(savingsRules(inputFixture({ facts: emptyTaxReturnFacts(2025) }))).toEqual({ suggestions: [], checks: [] });
  });

  it("does not offer to restart saving the plan models as ending, and keeps the plan-year figure on the live rules", () => {
    // The harmful shape is a rule that ran THROUGH the tax year and stops before the plan year —
    // contributions the advisor deliberately modelled as ending. Filtering to plan-year-active
    // rules makes it invisible, and the return's own $20,000 then falls through to the create arm
    // and offers to save it again from 2026 to 2060.
    const ended = planFixture({ accounts: [acct("a1", "sep_ira")], savingsRules: [rule("r1", "a1", 20_000, { startYear: 2015, endYear: 2025 })] });
    const r = savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: ended }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "savings.sepSimple", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].headline).toMatch(/sep_ira account[\s\S]*2025[\s\S]*2026/);
    // An inactive rule must never be shown a money figure: the plan pays nothing into the account
    // in 2026, so $0 is the honest plan figure and the prose says why.
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "sep_ira account", amount: 0, display: "$0", year: 2026 });
    expect(r.suggestions[0].link?.href).toBe(`/clients/${CLIENT_ID}/details/net-worth`);

    // With a live rule alongside the ended one, the aggregate is the live rule alone — $19,800, not
    // $39,800 — so the ended rule cannot make the plan look in line when it is not, or vice versa.
    const mixed = planFixture({ accounts: [acct("a1", "sep_ira")], savingsRules: [rule("r0", "a1", 20_000, { startYear: 2015, endYear: 2025 }), rule("r1", "a1", 19_800)] });
    expect(savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: mixed })).checks).toEqual([
      { id: "savings.sepSimple", label: "SEP / SIMPLE / solo 401(k) deduction", returnDisplay: "$20,000", planDisplay: "$19,800" },
    ]);
  });

  it("does not offer a second rule alongside one the plan starts later", () => {
    // The mirror image of the ended case, and the harmful one: a rule starting AFTER the plan year
    // is in neither the plan-year aggregate nor the ending set, so the return's $20,000 falls to the
    // create arm — and the new 2026-2060 rule would then contribute TWICE into the same SEP from
    // 2030 on, on top of the $20,000 already scheduled.
    const later = planFixture({ accounts: [acct("a1", "sep_ira")], savingsRules: [rule("r1", "a1", 20_000, { startYear: 2030, endYear: 2060 })] });
    const r = savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: later }));
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ id: "savings.sepSimple", kind: "review" });
    expect(r.suggestions[0].action).toBeUndefined();
    expect(r.suggestions[0].headline).toMatch(/sep_ira account[\s\S]*2030/);
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "sep_ira account", amount: 0, display: "$0", year: 2026 });
    expect(r.checks).toEqual([]);

    // The two predicates are asymmetric on purpose. A rule that ended in 2015 never contributes
    // again, so it cannot double up and the advisor is still offered the create.
    const longGone = planFixture({ accounts: [acct("a1", "sep_ira")], savingsRules: [rule("r0", "a1", 20_000, { startYear: 2010, endYear: 2015 })] });
    expect(savingsRules(inputFixture({ facts: factsWith(20_000, null), plan: longGone })).suggestions[0]).toMatchObject({ id: "savings.sepSimple.create", kind: "update" });
  });

  it("never counts or writes to a rule on an account of another kind", () => {
    // The account filter is what ROUTES the write. With it removed, the HSA's $8,300 rule would be
    // read as SEP contributions and line 16's $20,000 would be offered as a `savings_rule.update`
    // ONTO THE HSA RULE — a wrong write to an account the SEP line never mentioned.
    const plan = planFixture({ accounts: [acct("a1", "sep_ira"), acct("h1", "hsa")], savingsRules: [rule("r1", "h1", 8_300)] });
    const r = savingsRules(inputFixture({ facts: factsWith(20_000, 8_300), plan }));
    // SEP: no rule on a SEP account, so it creates one — on a1, never on h1.
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].id).toBe("savings.sepSimple.create");
    expect(r.suggestions[0].action?.target).toEqual({ kind: "savings_rule.create", amountField: "annualAmount", input: { accountId: "a1", annualAmount: 20_000, startYear: 2026, endYear: 2060, endYearRef: "client_retirement" } });
    expect(r.suggestions[0].planFigure).toMatchObject({ label: "Contributions to sep_ira account in the plan", amount: 0 });
    // HSA: its own rule matches its own line, exactly.
    expect(r.checks).toEqual([{ id: "savings.hsa", label: "HSA deduction", returnDisplay: "$8,300", planDisplay: "$8,300" }]);
  });

  it("names the account it will save into when several could hold the contribution", () => {
    // Two HSAs — one each for a client and a spouse — is an ordinary household. The apply payload
    // carries an amount and an owner, never an account, so the target is fixed server-side and the
    // advisor cannot redirect it. The copy therefore has to name the account chosen and say the
    // others exist.
    const plan = planFixture({ accounts: [{ id: "h1", name: "HSA — Dan", category: "retirement", subType: "hsa" }, { id: "h2", name: "HSA — Jane", category: "retirement", subType: "hsa" }] });
    const s = savingsRules(inputFixture({ facts: factsWith(null, 8_300), plan })).suggestions[0];
    expect(s.id).toBe("savings.hsa.create");
    expect(s.action?.target).toMatchObject({ kind: "savings_rule.create", input: { accountId: "h1", annualAmount: 8_300 } });
    // The account chosen is named, and the fact that a second exists is stated — in that order.
    expect(s.meaning).toMatch(/2 accounts[\s\S]*HSA — Dan/);
    expect(s.headline).toMatch(/HSA — Dan/);
    expect(s.action?.describe).toMatch(/HSA — Dan/);
    // With only one account the copy stays quiet about a choice that does not exist.
    const single = savingsRules(inputFixture({ facts: factsWith(null, 8_300), plan: planFixture({ accounts: [acct("h1", "hsa")] }) })).suggestions[0];
    expect(single.meaning).not.toMatch(/accounts that could hold it/);
  });
});
