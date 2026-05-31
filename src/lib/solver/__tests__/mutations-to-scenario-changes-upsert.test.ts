import { describe, it, expect } from "vitest";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import type { ClientData, Account } from "@/engine/types";

const ACCT: Account = {
  id: "new-acct", name: "John — Taxable", category: "taxable", subType: "brokerage",
  value: 0, basis: 0, growthRate: 0.06, rmdEnabled: false,
  titlingType: "jtwros", owners: [{ kind: "family_member", familyMemberId: "fm", percent: 100 }],
} as Account;

function tree(): ClientData {
  return { accounts: [], savingsRules: [], incomes: [], expenses: [], client: {} } as unknown as ClientData;
}

describe("mutationsToScenarioChanges — new account", () => {
  it("emits an 'add' draft for a brand-new account", () => {
    const drafts = mutationsToScenarioChanges(tree(), "client-1", [
      { kind: "account-upsert", id: "new-acct", value: ACCT },
    ]);
    const acct = drafts.find((d) => d.targetKind === "account");
    expect(acct).toBeDefined();
    expect(acct!.opType).toBe("add");
    expect(acct!.targetId).toBe("new-acct");
    expect(acct!.payload).toMatchObject({ name: "John — Taxable", category: "taxable" });
  });

  it("emits a 'remove' draft when value is null for an existing account", () => {
    const seeded = { ...tree(), accounts: [ACCT] };
    const drafts = mutationsToScenarioChanges(seeded as ClientData, "client-1", [
      { kind: "account-upsert", id: "new-acct", value: null },
    ]);
    const acct = drafts.find((d) => d.targetKind === "account");
    expect(acct?.opType).toBe("remove");
  });
});
