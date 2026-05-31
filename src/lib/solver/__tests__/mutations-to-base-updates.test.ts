import { describe, it, expect } from "vitest";
import { mutationsToBaseUpdates } from "../mutations-to-base-updates";
import type { ClientData, Account } from "@/engine/types";

const ACCT: Account = {
  id: "new", name: "John — Taxable", category: "taxable", subType: "brokerage",
  value: 0, basis: 0, growthRate: 0.06, rmdEnabled: false, titlingType: "jtwros",
  owners: [{ kind: "family_member", familyMemberId: "fm", percent: 100 }],
};
const source = { accounts: [], savingsRules: [] } as unknown as ClientData;

describe("mutationsToBaseUpdates", () => {
  it("classifies a brand-new account as an insert", () => {
    const out = mutationsToBaseUpdates(source, [
      { kind: "account-upsert", id: "new", value: ACCT },
    ]);
    expect(out.accountInserts).toHaveLength(1);
    expect(out.accountInserts[0].id).toBe("new");
    expect(out.accountUpdates).toHaveLength(0);
  });

  it("classifies an account already present in base as an update", () => {
    const out = mutationsToBaseUpdates({ ...source, accounts: [ACCT] } as ClientData, [
      { kind: "account-upsert", id: "new", value: { ...ACCT, name: "Renamed" } },
    ]);
    expect(out.accountInserts).toHaveLength(0);
    expect(out.accountUpdates).toHaveLength(1);
  });

  it("ignores a null (remove) value for base-facts save", () => {
    const out = mutationsToBaseUpdates(source, [{ kind: "account-upsert", id: "new", value: null }]);
    expect(out.accountInserts).toHaveLength(0);
    expect(out.accountUpdates).toHaveLength(0);
  });
});
