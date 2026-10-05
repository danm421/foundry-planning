import { describe, it, expect } from "vitest";
import {
  findGoalContributionRule,
  goalContributionRule,
  solveGoalDedicatedSavings,
} from "@/lib/solver/solve-goal-dedicated-savings";
import type { ClientData, ProjectionYear } from "@/engine/types";

// A goal costing $10k/yr for years 2032..2033, funded by "acct".
// Fake runProjection: each $1/yr of contribution to "acct" from currentYear..lastDrawYear
// accumulates linearly (no growth) and offsets shortfall dollar-for-dollar.
function tree(): ClientData {
  return {
    expenses: [{
      id: "goal", type: "education", name: "G", annualAmount: 10_000,
      startYear: 2032, endYear: 2033, growthRate: 0, dedicatedAccountIds: ["acct"],
      payShortfallOutOfPocket: false,
    }],
    accounts: [{ id: "acct" }],
    savingsRules: [],
    incomes: [],
  } as unknown as ClientData;
}

// Salary a percent-of-salary rule resolves against in the fake.
const SALARY = 10_000;

// Total goal cost = 20_000, paid in `lastYear`. Like the engine, every rule on
// "acct" contributes only inside its own years (here clipped to currentYear..
// lastYear, the years that can reach the goal), and a percent-of-salary rule
// contributes salary × percent whatever its annualAmount says.
// Default window 2026..2033 = 8 years: available = 8 × annualContribution.
function fakeRun(
  currentYear: number,
  lastYear = 2033,
  onTree?: (t: ClientData) => void,
): (t: ClientData) => ProjectionYear[] {
  return (t: ClientData) => {
    onTree?.(t);
    const available = t.savingsRules
      .filter((r) => r.accountId === "acct")
      .reduce((sum, r) => {
        const perYear = r.annualPercent ? SALARY * r.annualPercent : r.annualAmount;
        const years = Math.min(lastYear, r.endYear) - Math.max(currentYear, r.startYear) + 1;
        return sum + perYear * Math.max(0, years);
      }, 0);
    const remaining = Math.max(0, 20_000 - available);
    // Attribute the whole cost + shortfall to a single goal-year row for simplicity.
    return [{ year: lastYear, goals: [{ goalId: "goal", goalExpense: 20_000, dedicatedWithdrawal: 20_000 - remaining, outOfPocketWithdrawal: 0, shortfall: remaining } as never] } as never];
  };
}

describe("solveGoalDedicatedSavings", () => {
  it("returns 0 and reachesTarget when already funded", () => {
    const t = tree();
    (t.savingsRules as unknown[]).push({ id: "r", accountId: "acct", annualAmount: 5_000, isDeductible: false, startYear: 2026, endYear: 2033 });
    const r = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(r.additionalAnnual).toBe(0);
    expect(r.reachesTarget).toBe(true);
    expect(r.targetPct).toBe(1); // defaults to funding the goal in full
  });

  it("solves the additional level contribution to close the gap", () => {
    // No existing rule → needs 20_000 / 8 years = 2_500/yr.
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(r.reachesTarget).toBe(true);
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
  });

  it("solves to a PARTIAL target — 60% of a 20k goal needs 60% of the contribution", () => {
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026), targetPct: 0.6 });
    expect(r.reachesTarget).toBe(true);
    expect(r.targetPct).toBe(0.6);
    // 12_000 of the 20_000 cost over 8 years = 1_500/yr, well under the 2_500 a
    // full solve asks for — the remaining 8_000 is a deliberate shortfall.
    expect(Math.abs(r.additionalAnnual - 1_500)).toBeLessThanOrEqual(50);
  });

  it("a partial target is already met by a contribution too small to fund the goal fully", () => {
    const t = tree();
    // 2_000/yr × 8 = 16_000 of 20_000 → 80% funded: short of 100%, past 75%.
    (t.savingsRules as unknown[]).push({ id: "r", accountId: "acct", annualAmount: 2_000, isDeductible: false, startYear: 2026, endYear: 2033 });
    const partial = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026), targetPct: 0.75 });
    expect(partial.additionalAnnual).toBe(0);
    const full = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(full.additionalAnnual).toBeGreaterThan(0);
  });

  it("reports reachesTarget=false when the source cannot close the gap under the cap", () => {
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026), cap: 1_000 });
    expect(r.reachesTarget).toBe(false);
    expect(r.additionalAnnual).toBe(1_000);
  });
  it("sizes the savings even when cash flow pays the gap (Decision 7)", () => {
    // Same savings picture, but the goal pays its gap from cash flow: shortfall
    // is 0 while the savings still leave `remaining` uncovered.
    const coveredRun = (currentYear: number) => (t: ClientData) => {
      const rule = t.savingsRules.find((r) => r.accountId === "acct");
      const available = (rule?.annualAmount ?? 0) * (2033 - currentYear + 1);
      const remaining = Math.max(0, 20_000 - available);
      return [{ year: 2033, goals: [{ goalId: "goal", goalExpense: 20_000, dedicatedWithdrawal: 20_000 - remaining, outOfPocketWithdrawal: remaining, shortfall: 0 } as never] } as never];
    };
    const r = solveGoalDedicatedSavings({ tree: tree(), goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: coveredRun(2026) });
    expect(r.reachesTarget).toBe(true);
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
  });

  it("solves an Other goal the same way", () => {
    const t = tree();
    (t.expenses as unknown as Record<string, unknown>[])[0] = {
      ...(t.expenses[0] as unknown as Record<string, unknown>), type: "other", isGoal: true,
    };
    const r = solveGoalDedicatedSavings({ tree: t, goalId: "goal", accountId: "acct", currentYear: 2026, runProjection: fakeRun(2026) });
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
  });
});

describe("solveGoalDedicatedSavings — which savings rule it raises", () => {
  type Rule = ClientData["savingsRules"][number];
  const rule = (p: Partial<Rule>): Rule =>
    ({ id: "r", accountId: "acct", annualAmount: 0, isDeductible: false, startYear: 2026, endYear: 2033, ...p }) as Rule;
  const withRules = (rules: Rule[], goal: Record<string, unknown> = {}): ClientData => {
    const t = tree();
    (t.expenses as unknown as Record<string, unknown>[])[0] = {
      ...(t.expenses[0] as unknown as Record<string, unknown>), ...goal,
    };
    t.savingsRules = rules;
    return t;
  };
  /** Runs the solve, keeping the tree it modeled at its last step. */
  const solve = (t: ClientData, lastYear = 2033) => {
    let modeled: ClientData | undefined;
    const r = solveGoalDedicatedSavings({
      tree: t, goalId: "goal", accountId: "acct", currentYear: 2026,
      runProjection: fakeRun(2026, lastYear, (x) => { modeled = x; }),
    });
    return { r, modeled: modeled! };
  };

  it("leaves a general rule that runs past the goal alone and adds a goal rule ending with it", () => {
    // An Other goal paid in 2029 from a brokerage whose household rule runs to 2045.
    const otherGoal = { type: "other", isGoal: true, startYear: 2029, endYear: 2029 };
    const general = rule({ id: "general", annualAmount: 1_000, endYear: 2045 });
    const { r, modeled } = solve(withRules([general], otherGoal), 2029);

    // 2026..2029 = 4 deposits. The general rule's 4 × 1_000 already land in the
    // account, so the extra is (20_000 − 4_000) / 4 — exactly what a rule that
    // stopped at the goal would leave to fill.
    const stopsAtGoal = solve(withRules([rule({ id: "general", annualAmount: 1_000, endYear: 2029 })], otherGoal), 2029);
    expect(Math.abs(r.additionalAnnual - 4_000)).toBeLessThanOrEqual(50);
    expect(Math.abs(r.additionalAnnual - stopsAtGoal.r.additionalAnnual)).toBeLessThanOrEqual(1);

    expect(modeled.savingsRules.find((x) => x.id === "general")).toEqual(general);
    const goalRule = modeled.savingsRules.find((x) => x.id !== "general");
    expect(goalRule).toMatchObject({
      accountId: "acct", startYear: 2026, endYear: 2029, isDeductible: false,
    });
    // A scenario stores the rule's id in a uuid column.
    expect(goalRule!.id).toMatch(UUID);
  });

  it("reaches the target through a goal rule when the account's only rule already ended", () => {
    const ended = rule({ id: "old", annualAmount: 3_000, startYear: 2010, endYear: 2020 });
    const { r, modeled } = solve(withRules([ended]));
    expect(r.reachesTarget).toBe(true);
    expect(Math.abs(r.additionalAnnual - 2_500)).toBeLessThanOrEqual(50);
    expect(modeled.savingsRules.find((x) => x.id === "old")).toEqual(ended);
  });

  it("never raises a percent-of-salary rule — its amount isn't the dollar figure", () => {
    // 10% of 10_000 = 1_000/yr × 8 = 8_000 already; the rest comes from a goal rule.
    const pct = rule({ id: "pct", annualPercent: 0.1 });
    const { r, modeled } = solve(withRules([pct]));
    expect(r.reachesTarget).toBe(true);
    expect(Math.abs(r.additionalAnnual - 1_500)).toBeLessThanOrEqual(50);
    expect(modeled.savingsRules.find((x) => x.id === "pct")).toEqual(pct);
  });

  it("in a plan that began last year, raises the form's rule from this year to the goal's end", () => {
    // The projection starts in 2025; the Goals tab's "now" is 2026, which is
    // the year both goal forms stamp on the rule they write.
    const formRule = rule({ id: "form", annualAmount: 1_000, startYear: 2026, endYear: 2033 });
    let modeled: ClientData | undefined;
    solveGoalDedicatedSavings({
      tree: withRules([formRule]), goalId: "goal", accountId: "acct", currentYear: 2026,
      runProjection: fakeRun(2025, 2033, (x) => { modeled = x; }),
    });
    expect(modeled!.savingsRules.map((x) => x.id)).toEqual(["form"]);
    expect(modeled!.savingsRules[0].annualAmount).toBeGreaterThan(1_000);
  });

  it("still raises a 529 rule that runs from now to the goal's end", () => {
    const own = rule({ id: "r529", annualAmount: 1_000 });
    const { r, modeled } = solve(withRules([own]));
    expect(Math.abs(r.additionalAnnual - 1_500)).toBeLessThanOrEqual(50);
    expect(modeled.savingsRules).toHaveLength(1);
    expect(modeled.savingsRules[0].id).toBe("r529");
    expect(modeled.savingsRules[0].annualAmount).toBeGreaterThan(1_000);
  });

  it("raises a 529's rule even when it runs past the goal — a 529 only pays for education", () => {
    // Prod shape (goal e3efbe5d): $300/yr into the 529 from 2026 to 2039; the
    // goal runs 2030–2033.
    const t = withRules([rule({ id: "r529", annualAmount: 300, endYear: 2039 })], { startYear: 2030, endYear: 2033 });
    t.accounts = [{ id: "acct", category: "education_savings", subType: "529" }] as never;
    const { modeled } = solve(t);
    expect(modeled.savingsRules).toHaveLength(1);
    expect(modeled.savingsRules[0]).toMatchObject({ id: "r529", endYear: 2039 });
    expect(modeled.savingsRules[0].annualAmount).toBeGreaterThan(300);
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("goalContributionRule", () => {
  type Rule = ClientData["savingsRules"][number];
  const rule = (p: Partial<Rule>): Rule =>
    ({ id: "r", accountId: "acct", annualAmount: 0, isDeductible: false, startYear: 2026, endYear: 2033, ...p }) as Rule;
  const treeWith = (category: string, subType: string, rules: Rule[]) => ({
    accounts: [{ id: "acct", category, subType }] as unknown as ClientData["accounts"],
    savingsRules: rules,
  });
  const goal = { endYear: 2033 };
  const NEW_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

  it("gives a new goal rule the id its caller minted, spanning now → the goal's end", () => {
    const t = treeWith("taxable", "brokerage", []);
    expect(findGoalContributionRule(t, goal, "acct", 2026)).toBeUndefined();
    expect(goalContributionRule(t, goal, "acct", 2026, NEW_ID)).toMatchObject({
      id: NEW_ID, accountId: "acct", annualAmount: 0, startYear: 2026, endYear: 2033,
    });
  });

  it("finds the rule it wrote again by its shape, so a second write raises the same rule", () => {
    const t = treeWith("taxable", "brokerage", []);
    const first = { ...goalContributionRule(t, goal, "acct", 2026, NEW_ID), annualAmount: 2_000 };
    t.savingsRules = [first];
    expect(findGoalContributionRule(t, goal, "acct", 2026)).toBe(first);
    expect(goalContributionRule(t, goal, "acct", 2026, "11111111-1111-4111-8111-111111111111")).toBe(first);
  });

  it("picks a 529's fixed-amount rule active now, whatever its end year (prod shape)", () => {
    const r529 = rule({ id: "r529", annualAmount: 300, startYear: 2026, endYear: 2039 });
    const t = treeWith("education_savings", "529", [r529]);
    expect(findGoalContributionRule(t, { endYear: 2033 }, "acct", 2026)).toBe(r529);
    // A 529 filed under another category by a legacy import counts too.
    const legacy = treeWith("taxable", "529", [r529]);
    expect(findGoalContributionRule(legacy, { endYear: 2033 }, "acct", 2026)).toBe(r529);
  });

  it("still skips a 529 rule that isn't active now", () => {
    const later = rule({ id: "later", annualAmount: 300, startYear: 2028, endYear: 2039 });
    expect(findGoalContributionRule(treeWith("education_savings", "529", [later]), goal, "acct", 2026)).toBeUndefined();
  });

  it("keeps the strict test on a household account: a rule running past the goal is not the goal's", () => {
    const general = rule({ id: "general", annualAmount: 6_000, endYear: 2045 });
    const t = treeWith("taxable", "brokerage", [general]);
    expect(findGoalContributionRule(t, goal, "acct", 2026)).toBeUndefined();
    expect(goalContributionRule(t, goal, "acct", 2026, NEW_ID).id).toBe(NEW_ID);
  });
});
