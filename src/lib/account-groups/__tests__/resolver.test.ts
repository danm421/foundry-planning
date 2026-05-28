import { describe, it, expect } from "vitest";
import { resolveGroup, DEFAULT_GROUP_KEYS } from "../resolver";
import type { AccountCategory } from "../liquid-filter";

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
      fetchAccounts: async () => mkAccounts() as Array<{ id: string; category: AccountCategory }>,
      fetchCustomGroup: async () => null,
    });
    expect(result.isDefault).toBe(true);
    expect(result.groupName).toBe("All Liquid Assets");
    expect(result.accountIds.sort()).toEqual(["a1", "a2", "a3"]);
    expect(result.strippedMemberCount).toBeUndefined();
  });

  it("'taxable' returns only taxable accounts", async () => {
    const r = await resolveGroup("client-1", "taxable", {
      fetchAccounts: async () => mkAccounts() as Array<{ id: string; category: AccountCategory }>,
      fetchCustomGroup: async () => null,
    });
    expect(r.isDefault).toBe(true);
    expect(r.groupName).toBe("Taxable");
    expect(r.accountIds).toEqual(["a1"]);
  });

  it("'retirement' returns only retirement accounts", async () => {
    const r = await resolveGroup("client-1", "retirement", {
      fetchAccounts: async () => mkAccounts() as Array<{ id: string; category: AccountCategory }>,
      fetchCustomGroup: async () => null,
    });
    expect(r.accountIds).toEqual(["a3"]);
  });

  it("'cash' returns only cash accounts", async () => {
    const r = await resolveGroup("client-1", "cash", {
      fetchAccounts: async () => mkAccounts() as Array<{ id: string; category: AccountCategory }>,
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

describe("resolveGroup — custom UUID branch", () => {
  const accounts: Array<{ id: string; category: AccountCategory }> = [
    { id: "a1", category: "taxable" },
    { id: "a2", category: "cash" },
    { id: "a3", category: "retirement" },
    { id: "a4", category: "real_estate" }, // illiquid — should be stripped if listed as member
  ];

  it("returns the group's liquid members", async () => {
    const r = await resolveGroup("client-1", "group-uuid-1", {
      fetchAccounts: async () => accounts,
      fetchCustomGroup: async () => ({
        name: "Long-term Growth",
        color: "#ff8800",
        memberAccountIds: ["a1", "a3"],
      }),
    });
    expect(r.isDefault).toBe(false);
    expect(r.groupName).toBe("Long-term Growth");
    expect(r.groupColor).toBe("#ff8800");
    expect(r.accountIds.sort()).toEqual(["a1", "a3"]);
    expect(r.strippedMemberCount).toBe(0);
  });

  it("strips illiquid members and reports the stripped count", async () => {
    const r = await resolveGroup("client-1", "group-uuid-1", {
      fetchAccounts: async () => accounts,
      fetchCustomGroup: async () => ({
        name: "Mixed",
        color: null,
        memberAccountIds: ["a1", "a4", "a3"], // a4 is real_estate
      }),
    });
    expect(r.accountIds.sort()).toEqual(["a1", "a3"]);
    expect(r.strippedMemberCount).toBe(1);
  });

  it("strips members not present in the client's accounts (defensive)", async () => {
    const r = await resolveGroup("client-1", "group-uuid-1", {
      fetchAccounts: async () => accounts,
      fetchCustomGroup: async () => ({
        name: "Stale",
        color: null,
        memberAccountIds: ["a1", "ghost-account-id"],
      }),
    });
    expect(r.accountIds).toEqual(["a1"]);
    expect(r.strippedMemberCount).toBe(1);
  });

  it("throws a typed error when the custom group is missing", async () => {
    await expect(
      resolveGroup("client-1", "missing-uuid", {
        fetchAccounts: async () => accounts,
        fetchCustomGroup: async () => null,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("returns an empty account list for an empty custom group", async () => {
    const r = await resolveGroup("client-1", "group-uuid-1", {
      fetchAccounts: async () => accounts,
      fetchCustomGroup: async () => ({
        name: "Empty",
        color: null,
        memberAccountIds: [],
      }),
    });
    expect(r.accountIds).toEqual([]);
    expect(r.strippedMemberCount).toBe(0);
  });
});
