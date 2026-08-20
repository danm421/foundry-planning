import { describe, it, expect } from "vitest";
import { resolveRungs, ladderMutations, ladderBlocker } from "../rungs";
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

function salary(annualAmount: number, over: Partial<Income> = {}): Income {
  return {
    id: "i1",
    type: "salary",
    name: "Salary",
    annualAmount,
    startYear: 2020,
    endYear: 2060,
    growthRate: 0,
    owner: "client",
    ...over,
  } as Income;
}

function tree(
  rules: SavingsRule[],
  incomes: Income[] = [salary(120_000)],
  extra: Record<string, unknown> = {},
): ClientData {
  return {
    planSettings: { planStartYear: 2026, inflationRate: 0.03 },
    savingsRules: rules,
    incomes,
    ...extra,
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
    expect(ladderMutations(twoAccounts(), 0.08, 0.08)).toEqual([]);
  });

  it("applies the whole delta to the largest deferral account, leaving the others alone", () => {
    const ms = ladderMutations(twoAccounts(), 0.14, 0.08);
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
    const ms = ladderMutations(t, 0.16, 0.1);
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
    expect(ladderMutations(t, 0.14, 0.08)).toEqual([]);
  });

  it("never targets an account already contributing the annual maximum", () => {
    const t = tree([rule({ accountId: "maxed", contributeMax: true })]);
    expect(ladderMutations(t, 0.14, 0.08)).toEqual([]);
  });

  it("clamps the account's new percent to the whole salary", () => {
    const t = tree([rule({ accountId: "a1", annualPercent: 0.9 })]);
    expect(deferrals(ladderMutations(t, 1.4, 0.9))).toEqual([{ accountId: "a1", percent: 1 }]);
  });

  // F2's second-order effect. The rung is a share of HOUSEHOLD pay — the
  // quantity both sheets print — but `annualPercent` is resolved against the
  // ACCOUNT OWNER's slice. Written straight through, a +3pp rung on a spouse
  // earning $160k of a $505k household delivers +0.95pp and the bar carries a
  // rate the plan never runs at.
  describe("a household rung on a two-earner household", () => {
    const HOUSEHOLD = 505_000;
    const SUSAN = 160_000;
    const cooperAndSusan = () =>
      tree(
        [rule({ id: "r-s", accountId: "susan-401k", annualPercent: 0.1 })],
        [
          salary(345_000, { id: "i-c", owner: "client" }),
          salary(SUSAN, { id: "i-s", owner: "spouse" }),
        ],
        {
          familyMembers: [
            { id: "fm-c", role: "client" },
            { id: "fm-s", role: "spouse" },
          ],
          accounts: [
            {
              id: "susan-401k",
              owners: [{ kind: "family_member", familyMemberId: "fm-s", percent: 1 }],
            },
          ],
        },
      );

    it("moves the owner's rate by enough to deliver the household's extra dollars", () => {
      const current = 0.0465346534653; // 23,500 / 505,000, as the engine ran it
      const [only] = deferrals(ladderMutations(cooperAndSusan(), current + 0.03, current));
      expect(only.accountId).toBe("susan-401k");
      // Measured as the thing that matters: the extra dollars the plan now
      // contributes must be three points of HOUSEHOLD pay.
      const extra = only.percent! * SUSAN - 0.1 * SUSAN;
      expect(extra).toBeCloseTo(0.03 * HOUSEHOLD, 6);
    });

    it("picks the account holding the most dollars, not the highest percent", () => {
      const t = cooperAndSusan();
      // Cooper defers 4% of $345,000 = $13,800; Susan 10% of $160,000 =
      // $16,000. Comparing the percents alone would move Susan's; comparing
      // dollars moves hers too — so make Cooper's the bigger one.
      (t as unknown as { savingsRules: SavingsRule[] }).savingsRules.push(
        rule({ id: "r-c", accountId: "cooper-401k", annualPercent: 0.06 }),
      );
      (t as unknown as { accounts: unknown[] }).accounts.push({
        id: "cooper-401k",
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
      });
      const [only] = deferrals(ladderMutations(t, 0.1, 0.05));
      expect(only.accountId).toBe("cooper-401k"); // $20,700 > $16,000
    });
  });
});

describe("ladderBlocker", () => {
  it("is clear when the plan has a deferral the ladder can move", () => {
    expect(ladderBlocker(tree([rule({ accountId: "a1", annualPercent: 0.08 })]))).toBeNull();
  });

  it("reports a plan with no payroll deferral at all", () => {
    expect(ladderBlocker(tree([]))).toBe("no-deferral");
  });

  // F1 — Michael Mitchell's two rules both contribute the IRS maximum. There
  // IS a contribution, and the sheet before this one just printed it; what
  // there is not is a rate left to raise.
  it("reports a plan whose contributions are already at the annual maximum", () => {
    const t = tree([
      rule({ id: "r1", accountId: "401k", contributeMax: true }),
      rule({ id: "r2", accountId: "roth", contributeMax: true }),
    ]);
    expect(ladderBlocker(t)).toBe("at-annual-maximum");
  });

  it("reports a plan whose contributions cannot be expressed as one rate", () => {
    const t = tree([
      rule({ id: "r1", accountId: "shared", annualPercent: 0.05 }),
      rule({ id: "r2", accountId: "shared", annualPercent: 0.03 }),
    ]);
    expect(ladderBlocker(t)).toBe("not-modellable");
  });
});

describe("ladderMutations expresses the rung in the rule's own mode", () => {
  it("writes a percent for an account already in percent mode", () => {
    const data = tree([rule({ accountId: "a1", annualPercent: 0.08 })]);
    expect(ladderMutations(data, 0.11, 0.08)).toEqual<SolverMutation[]>([
      { kind: "savings-annual-percent", accountId: "a1", percent: 0.11 },
    ]);
  });

  it("writes DOLLARS for a flat-dollar account, so the rung does not index it to pay", () => {
    // $12,000 on a $120,000 salary = an implied 10%. +3pp of household pay is
    // +$3,600, so the raised rung funds $15,600 — still flat.
    const data = tree([rule({ accountId: "a1", annualAmount: 12_000 })]);
    const [m] = ladderMutations(data, 0.13, 0.1);
    expect(m.kind).toBe("savings-contribution");
    expect(m).toMatchObject({ accountId: "a1" });
    expect((m as { annualAmount: number }).annualAmount).toBeCloseTo(15_600, 6);
  });

  it("never writes annualPercent onto a flat-dollar rule (the indexation defect)", () => {
    const data = tree([rule({ accountId: "a1", annualAmount: 12_000 })]);
    expect(ladderMutations(data, 0.16, 0.1).map((m) => m.kind)).not.toContain(
      "savings-annual-percent",
    );
  });

  it("still returns nothing for the baseline rung, in either mode (R13)", () => {
    expect(
      ladderMutations(tree([rule({ accountId: "a1", annualAmount: 12_000 })]), 0.1, 0.1),
    ).toEqual([]);
    expect(
      ladderMutations(tree([rule({ accountId: "a1", annualPercent: 0.08 })]), 0.08, 0.08),
    ).toEqual([]);
  });
});
