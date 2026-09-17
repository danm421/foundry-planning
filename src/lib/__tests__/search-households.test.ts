import { describe, it, expect, vi, beforeEach } from "vitest";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db", () => ({ db: { select } }));
vi.mock("@/lib/visibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visibility")>()),
  resolveVisibleAdvisorIds: vi.fn().mockResolvedValue(new Set(["user_1"])),
}));

import { searchHouseholds } from "../client-search";

function mockRows(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(rows);
  select.mockReturnValue(chain);
}

beforeEach(() => select.mockReset());

describe("searchHouseholds", () => {
  it("labels a household that has a planning client", async () => {
    mockRows([{
      householdId: "hh1", clientId: "c1", householdName: "Mueller",
      contactRole: "primary", contactFirstName: "Dan", contactLastName: "Mueller",
    }]);
    const out = await searchHouseholds("mue", "org_1", { userId: "user_1", orgRole: "org:member" });
    expect(out).toEqual([{
      householdId: "hh1", clientId: "c1", householdTitle: "Mueller", hasPlan: true,
    }]);
  });

  it("returns a prospect household with no planning client", async () => {
    mockRows([{
      householdId: "hh2", clientId: null, householdName: "Okafor",
      contactRole: "primary", contactFirstName: "Ada", contactLastName: "Okafor",
    }]);
    const out = await searchHouseholds("oka", "org_1", { userId: "user_1", orgRole: "org:member" });
    expect(out).toEqual([{
      householdId: "hh2", clientId: null, householdTitle: "Okafor", hasPlan: false,
    }]);
  });

  it("never emits contact PII", async () => {
    mockRows([{
      householdId: "hh1", clientId: "c1", householdName: "Mueller",
      contactRole: "primary", contactFirstName: "Dan", contactLastName: "Mueller",
      contactEmail: "dan@example.com",
    }]);
    const out = await searchHouseholds("mue", "org_1", { userId: "user_1" });
    expect(JSON.stringify(out)).not.toContain("dan@example.com");
    expect(JSON.stringify(out)).not.toContain("Dan");
  });
});
