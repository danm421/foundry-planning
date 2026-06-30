import { describe, it, expect } from "vitest";
import { applyMutations } from "../apply-mutations";
import type { ClientData, Account, SavingsRule, Relocation } from "@/engine/types";

function baseTree(): ClientData {
  // Minimal tree — only the arrays the upsert cases touch must exist.
  return {
    client: {} as never,
    accounts: [],
    savingsRules: [],
    incomes: [],
    expenses: [],
    planSettings: {} as ClientData["planSettings"],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

const ACCT: Account = {
  id: "a1", name: "John — Taxable", category: "taxable", subType: "brokerage",
  value: 0, basis: 0, growthRate: 0.06, rmdEnabled: false,
  titlingType: "jtwros", owners: [{ kind: "family_member", familyMemberId: "fm", percent: 100 }],
};
const RULE: SavingsRule = {
  id: "r1", accountId: "a1", annualAmount: 12000, isDeductible: false, startYear: 2026, endYear: 2045,
};

const RELOCATION: Relocation = {
  id: "rel-1",
  name: "Move to Florida",
  year: 2030,
  destinationState: "FL",
};

describe("applyMutations — relocation-upsert", () => {
  it("appends a new relocation", () => {
    const out = applyMutations(baseTree(), [
      { kind: "relocation-upsert", id: "rel-1", value: RELOCATION },
    ]);
    expect(out.relocations).toHaveLength(1);
    expect(out.relocations![0].id).toBe("rel-1");
    expect(out.relocations![0].destinationState).toBe("FL");
  });

  it("replaces by id (last write wins)", () => {
    const seeded = applyMutations(baseTree(), [
      { kind: "relocation-upsert", id: "rel-1", value: RELOCATION },
    ]);
    const out = applyMutations(seeded, [
      { kind: "relocation-upsert", id: "rel-1", value: { ...RELOCATION, destinationState: "WA" } },
    ]);
    expect(out.relocations).toHaveLength(1);
    expect(out.relocations![0].destinationState).toBe("WA");
  });

  it("removes when value is null", () => {
    const seeded = applyMutations(baseTree(), [
      { kind: "relocation-upsert", id: "rel-1", value: RELOCATION },
    ]);
    const out = applyMutations(seeded, [
      { kind: "relocation-upsert", id: "rel-1", value: null },
    ]);
    expect(out.relocations).toHaveLength(0);
  });
});

describe("applyMutations — account/savings-rule upsert", () => {
  it("appends a new account and rule", () => {
    const out = applyMutations(baseTree(), [
      { kind: "account-upsert", id: "a1", value: ACCT },
      { kind: "savings-rule-upsert", id: "r1", value: RULE },
    ]);
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0].id).toBe("a1");
    expect(out.savingsRules).toHaveLength(1);
    expect(out.savingsRules[0].annualAmount).toBe(12000);
  });

  it("replaces by id (last write wins)", () => {
    const out = applyMutations(baseTree(), [
      { kind: "account-upsert", id: "a1", value: ACCT },
      { kind: "account-upsert", id: "a1", value: { ...ACCT, name: "Renamed" } },
    ]);
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0].name).toBe("Renamed");
  });

  it("removes when value is null", () => {
    const seeded = applyMutations(baseTree(), [{ kind: "account-upsert", id: "a1", value: ACCT }]);
    const out = applyMutations(seeded, [{ kind: "account-upsert", id: "a1", value: null }]);
    expect(out.accounts).toHaveLength(0);
  });
});
