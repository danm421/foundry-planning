// src/lib/solver/__tests__/solve-target-search-tree.test.ts
//
// Verifies that solveTarget resolves the lever search config against the
// post-baseline tree, so entities injected via baselineMutations (e.g. a new
// savings account + fundFromExpenseReduction rule) are visible to leverSearchConfig.

import { describe, it, expect, vi } from "vitest";
import * as lever from "../lever-search-config";

vi.mock("@/engine", () => ({
  createReturnEngine: () => ({}),
  runProjection: () => [],
  runMonteCarlo: async () => ({ successRate: 0.9 }),
}));

describe("solveTarget applies baseline mutations before leverSearchConfig", () => {
  it("passes a tree that includes the injected savings rule to leverSearchConfig", async () => {
    const { solveTarget } = await import("../solve-target");
    const spy = vi.spyOn(lever, "leverSearchConfig");

    const effectiveTree = {
      accounts: [],
      savingsRules: [],
      expenses: [{ type: "living", annualAmount: 80_000 }],
      incomes: [],
      liabilities: [],
      withdrawalStrategy: [],
      planSettings: {},
      giftEvents: [],
      client: {},
    } as never;

    await solveTarget({
      effectiveTree,
      mcPayload: {
        indices: [],
        correlation: [],
        seed: 1,
        accountMixes: [],
        requiredMinimumAssetLevel: 0,
      } as never,
      baselineMutations: [
        {
          kind: "account-upsert",
          id: "a1",
          value: {
            id: "a1",
            name: "x",
            category: "taxable",
            subType: "brokerage",
            value: 0,
            basis: 0,
            growthRate: 0.06,
            rmdEnabled: false,
            titlingType: "jtwros",
            owners: [],
          } as never,
        },
        {
          kind: "savings-rule-upsert",
          id: "r1",
          value: {
            id: "r1",
            accountId: "a1",
            annualAmount: 0,
            isDeductible: false,
            startYear: 2026,
            endYear: 2045,
            fundFromExpenseReduction: true,
          } as never,
        },
      ],
      target: { kind: "savings-contribution", accountId: "a1" },
      targetPoS: 0.9,
      trials: 1,
    });

    // leverSearchConfig is called with (target, tree) — tree is the 2nd argument.
    const treeSeenBySearch = spy.mock.calls[0][1] as {
      savingsRules: Array<{ accountId: string }>;
    };
    expect(treeSeenBySearch.savingsRules.some((r) => r.accountId === "a1")).toBe(true);
  });
});
