import { describe, it, expect } from "vitest";
import { resolveRungs, householdCurrentPercent, ladderMutations } from "../rungs";
import type { ClientData, Income, SavingsRule } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";

function rule(over: Partial<SavingsRule> & { accountId: string }): SavingsRule {
  return {
    id: over.accountId + "-r",
    annualAmount: 0,
    isDeductible: true,
    startYear: 2020,
    endYear: 2060,
    ...over,
  };
}

function salary(annualAmount: number): Income {
  return {
    id: "i1",
    type: "salary",
    name: "Salary",
    annualAmount,
    startYear: 2020,
    endYear: 2060,
    growthRate: 0.03,
    owner: "client",
  } as Income;
}

function tree(rules: SavingsRule[], incomes: Income[] = [salary(120_000)]): ClientData {
  return {
    planSettings: { planStartYear: 2026, inflationRate: 0.03 },
    savingsRules: rules,
    incomes,
  } as unknown as ClientData;
}

describe("resolveRungs", () => {
  it("defaults to the client's own rate plus three and six points", () => {
    expect(resolveRungs({ mode: "relative", offsets: [0, 0.03, 0.06] }, 0.08))
      .toEqual([
        { percent: 0.08, label: "Save 8%", isCurrent: true },
        { percent: 0.11, label: "Save 11%", isCurrent: false },
        { percent: 0.14, label: "Save 14%", isCurrent: false },
      ]);
  });

  it("uses the advisor's absolute percentages when set", () => {
    expect(resolveRungs({ mode: "absolute", percents: [0.06, 0.1, 0.15] }, 0.08))
      .toEqual([
        { percent: 0.06, label: "Save 6%", isCurrent: false },
        { percent: 0.10, label: "Save 10%", isCurrent: false },
        { percent: 0.15, label: "Save 15%", isCurrent: false },
      ]);
  });

  it("marks an absolute rung that lands on the client's current rate", () => {
    const rungs = resolveRungs({ mode: "absolute", percents: [0.08, 0.12] }, 0.08);
    expect(rungs[0].isCurrent).toBe(true);
  });

  it("rounds a fractional current rate to a whole percent in the label", () => {
    expect(resolveRungs({ mode: "relative", offsets: [0] }, 0.0834)[0].label).toBe("Save 8%");
  });

  // R11 — `applyMutations` does not validate, so an unclamped rung would set a
  // deferral above 100% of salary and the projection would run with it.
  it("clamps a rung that would exceed the whole salary", () => {
    expect(resolveRungs({ mode: "relative", offsets: [0, 0.06] }, 0.97).map((r) => r.percent))
      .toEqual([0.97, 1]);
  });

  it("clamps a negative absolute rung to zero", () => {
    expect(resolveRungs({ mode: "absolute", percents: [-0.05] }, 0.08)[0].percent).toBe(0);
  });
});

describe("householdCurrentPercent", () => {
  it("is the SUM of every active deferral, not the first account's rate", () => {
    const t = tree([
      rule({ id: "r1", accountId: "a1", annualPercent: 0.06 }),
      rule({ id: "r2", accountId: "a2", annualPercent: 0.04 }),
    ]);
    expect(householdCurrentPercent(t)).toBeCloseTo(0.1, 9);
  });

  it("is zero when the plan has no payroll deferral at all", () => {
    expect(householdCurrentPercent(tree([]))).toBe(0);
  });
});

/** The deferral mutations only, narrowed off the `SolverMutation` union. The
 *  percent is float arithmetic (0.06 + 0.06 is not 0.12), so it is compared at
 *  nine decimals rather than by equality. */
function deferrals(ms: SolverMutation[]): Array<{ accountId: string; percent: number | null }> {
  return ms.flatMap((m) =>
    m.kind === "savings-annual-percent" ? [{ accountId: m.accountId, percent: m.percent }] : [],
  );
}

describe("ladderMutations", () => {
  const twoAccounts = () =>
    tree([
      rule({ id: "r1", accountId: "big", annualPercent: 0.06 }),
      rule({ id: "r2", accountId: "small", annualPercent: 0.02 }),
    ]);

  // R13 — the "what you save now" bar has to BE what they save now. Rung 0
  // asks for the household's own rate, so it must move nothing.
  it("returns no mutations for a rung that equals the household's current rate", () => {
    expect(ladderMutations(twoAccounts(), 0.08)).toEqual([]);
  });

  it("applies the whole delta to the largest deferral account, leaving the others alone", () => {
    const ms = ladderMutations(twoAccounts(), 0.14);
    expect(ms).toHaveLength(1);
    const [only] = deferrals(ms);
    expect(only.accountId).toBe("big");
    expect(only.percent).toBeCloseTo(0.12, 9);
  });

  // R10 — `applyMutations` sets the percent on EVERY rule sharing the account
  // id, so a two-rule account would defer twice what the rung asks for.
  it("never targets an account fed by more than one savings rule", () => {
    const t = tree([
      rule({ id: "r1", accountId: "shared", annualPercent: 0.05 }),
      rule({ id: "r2", accountId: "shared", annualPercent: 0.03 }),
      rule({ id: "r3", accountId: "solo", annualPercent: 0.02 }),
    ]);
    const ms = ladderMutations(t, 0.16);
    expect(ms).toHaveLength(1);
    const [only] = deferrals(ms);
    expect(only.accountId).toBe("solo");
    expect(only.percent).toBeCloseTo(0.08, 9);
  });

  it("returns no mutations when every deferral account carries multiple rules", () => {
    const t = tree([
      rule({ id: "r1", accountId: "shared", annualPercent: 0.05 }),
      rule({ id: "r2", accountId: "shared", annualPercent: 0.03 }),
    ]);
    expect(ladderMutations(t, 0.14)).toEqual([]);
  });

  it("clamps the account's new percent to the whole salary", () => {
    const t = tree([rule({ accountId: "a1", annualPercent: 0.9 })]);
    expect(deferrals(ladderMutations(t, 1.4))).toEqual([{ accountId: "a1", percent: 1 }]);
  });
});
