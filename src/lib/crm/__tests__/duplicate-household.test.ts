// findLikelyDuplicateHousehold keeps only candidates the caller may see, through
// the REAL household access check (book silo, Private clients, trash, other firm).
// The database and the firm setting are faked: `candidates` is what the name and
// date-of-birth query returns, and `households` the access check's row for each
// candidate, in order. (The query's own SQL is not exercised here.)
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "org_dup";
const state = vi.hoisted(() => ({
  candidates: [] as { householdId: string; name: string; clientId: string | null }[],
  households: [] as unknown[],
  silo: true,
}));

vi.mock("@/lib/firm-settings", () => ({ firmBookSiloEnabled: async () => state.silo }));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin"]) chain[m] = () => chain;
  chain.where = async () => state.candidates;
  return {
    db: {
      select: () => chain,
      query: { crmHouseholds: { findFirst: async () => state.households.shift() } },
    },
  };
});

import { findLikelyDuplicateHousehold } from "../duplicate-household";

const person = { firstName: "Ada", lastName: "Quill", dateOfBirth: "1970-02-03" };
const member = { userId: "adv_b", orgId: ORG, orgRole: "org:member" };
const candidate = (householdId: string, clientId: string | null = null) => ({ householdId, name: `HH ${householdId}`, clientId });
const row = (advisorId: string, extra: Record<string, unknown> = {}) => ({
  firmId: ORG,
  advisorId,
  deletedAt: null,
  planningClient: null,
  ...extra,
});

beforeEach(() => {
  state.silo = true;
  state.candidates = [];
  state.households = [];
});

describe("findLikelyDuplicateHousehold", () => {
  it("returns the caller's own household", async () => {
    state.candidates = [candidate("hh-1", "c-1")];
    state.households = [row("adv_b")];
    expect(await findLikelyDuplicateHousehold(member, person)).toEqual({ householdId: "hh-1", name: "HH hh-1", clientId: "c-1" });
  });

  it("does not see a duplicate in another advisor's siloed book", async () => {
    state.candidates = [candidate("hh-a")];
    state.households = [row("adv_a")];
    expect(await findLikelyDuplicateHousehold(member, person)).toBeNull();
  });

  it("sees that household when the firm has no book silo, or the caller is an admin", async () => {
    state.silo = false;
    state.candidates = [candidate("hh-a")];
    state.households = [row("adv_a")];
    expect(await findLikelyDuplicateHousehold(member, person)).toMatchObject({ householdId: "hh-a" });

    state.silo = true;
    state.households = [row("adv_a")];
    expect(await findLikelyDuplicateHousehold({ ...member, orgRole: "org:admin" }, person)).toMatchObject({ householdId: "hh-a" });
  });

  it("skips a colleague's Private client and a trashed household, then takes the next visible one", async () => {
    state.silo = false;
    state.candidates = [candidate("hh-priv"), candidate("hh-trash"), candidate("hh-ok")];
    state.households = [
      row("adv_a", { planningClient: { isPrivate: true, advisorId: "adv_a" } }),
      row("adv_b", { deletedAt: new Date() }),
      row("adv_b"),
    ];
    expect(await findLikelyDuplicateHousehold(member, person)).toMatchObject({ householdId: "hh-ok" });
  });

  it("finds nothing without candidates or without an organization", async () => {
    expect(await findLikelyDuplicateHousehold(member, person)).toBeNull();
    expect(await findLikelyDuplicateHousehold({ ...member, orgId: null }, person)).toBeNull();
  });
});
