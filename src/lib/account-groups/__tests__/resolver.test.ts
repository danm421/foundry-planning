import { describe, it, expect } from "vitest";
import { resolveGroup, DEFAULT_GROUP_KEYS, type ResolvedGroup } from "../resolver";

type AccountLite = { id: string; category: string };

function mkAccounts(): AccountLite[] {
  return [
    { id: "a1", category: "taxable" },
    { id: "a2", category: "cash" },
    { id: "a3", category: "retirement" },
    { id: "a4", category: "real_estate" },
    { id: "a5", category: "business" },
  ];
}

describe("resolveGroup — default keys", () => {
  it("'all-liquid' returns every liquid account", async () => {
    const result = await resolveGroup("client-1", "all-liquid", {
      fetchAccounts: async () => mkAccounts(),
      fetchCustomGroup: async () => null,
    });
    expect(result.isDefault).toBe(true);
    expect(result.groupName).toBe("All Liquid Assets");
    expect(result.accountIds.sort()).toEqual(["a1", "a2", "a3"]);
    expect(result.strippedMemberCount).toBeUndefined();
  });

  it("'taxable' returns only taxable accounts", async () => {
    const r = await resolveGroup("client-1", "taxable", {
      fetchAccounts: async () => mkAccounts(),
      fetchCustomGroup: async () => null,
    });
    expect(r.isDefault).toBe(true);
    expect(r.groupName).toBe("Taxable");
    expect(r.accountIds).toEqual(["a1"]);
  });

  it("'retirement' returns only retirement accounts", async () => {
    const r = await resolveGroup("client-1", "retirement", {
      fetchAccounts: async () => mkAccounts(),
      fetchCustomGroup: async () => null,
    });
    expect(r.accountIds).toEqual(["a3"]);
  });

  it("'cash' returns only cash accounts", async () => {
    const r = await resolveGroup("client-1", "cash", {
      fetchAccounts: async () => mkAccounts(),
      fetchCustomGroup: async () => null,
    });
    expect(r.accountIds).toEqual(["a2"]);
  });

  it("DEFAULT_GROUP_KEYS exposes the four default keys", () => {
    expect([...DEFAULT_GROUP_KEYS].sort()).toEqual([
      "all-liquid",
      "cash",
      "retirement",
      "taxable",
    ]);
  });
});
