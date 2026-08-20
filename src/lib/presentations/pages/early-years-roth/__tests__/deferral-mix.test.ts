import { describe, it, expect } from "vitest";
import { rothDeferralAccountIds, rothMixMutations } from "../deferral-mix";
import type { ClientData } from "@/engine/types";

const tree = (accounts: Array<{ id: string; subType: string }>): ClientData =>
  ({
    planSettings: { planStartYear: 2026, inflationRate: 0.03 },
    // `owners` is required: `controllingFamilyMember` reads it unguarded.
    accounts: accounts.map((a) => ({ ...a, owners: [] })),
    savingsRules: accounts.map((a, i) => ({
      id: `r${i}`,
      accountId: a.id,
      annualAmount: 0,
      annualPercent: 0.08,
      isDeductible: true,
      startYear: 2020,
      endYear: 2060,
    })),
    incomes: [
      {
        id: "i1",
        type: "salary",
        name: "Salary",
        annualAmount: 120_000,
        owner: "client",
        growthRate: 0,
        startYear: 2020,
        endYear: 2060,
      },
    ],
  }) as unknown as ClientData;

describe("rothDeferralAccountIds", () => {
  it("keeps 401(k) and 403(b) accounts", () => {
    expect(
      rothDeferralAccountIds(
        tree([
          { id: "a1", subType: "401k" },
          { id: "a2", subType: "403b" },
        ]),
      ),
    ).toEqual(["a1", "a2"]);
  });

  it("drops an account whose subtype the engine ignores rothPercent on", () => {
    // projection.ts gates the Roth basis on subType 401k/403b only.
    expect(rothDeferralAccountIds(tree([{ id: "a1", subType: "ira" }]))).toEqual([]);
    expect(rothDeferralAccountIds(tree([{ id: "a1", subType: "taxable" }]))).toEqual([]);
  });

  it("drops an eligible account the plan does not actually defer into", () => {
    const t = tree([{ id: "a1", subType: "401k" }]);
    (t as unknown as { savingsRules: unknown[] }).savingsRules = [];
    expect(rothDeferralAccountIds(t)).toEqual([]);
  });
});

describe("rothMixMutations", () => {
  it("sets every eligible account to the asked-for mix", () => {
    expect(rothMixMutations(tree([{ id: "a1", subType: "401k" }]), 1)).toEqual([
      { kind: "savings-roth-percent", accountId: "a1", rothPercent: 1 },
    ]);
    expect(rothMixMutations(tree([{ id: "a1", subType: "401k" }]), 0)).toEqual([
      { kind: "savings-roth-percent", accountId: "a1", rothPercent: 0 },
    ]);
  });

  it("returns nothing when no account can carry the change", () => {
    expect(rothMixMutations(tree([{ id: "a1", subType: "ira" }]), 0)).toEqual([]);
  });
});
