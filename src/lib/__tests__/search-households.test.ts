import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// Only `@/db` is mocked — the schema, drizzle-orm, and `@/lib/like-pattern`
// are all real, so the boundary assertions below read the SQL
// `searchHouseholds` actually builds (firm scope, Trash exclusion, advisor
// scope), not a canned string a mutation of the real WHERE could still
// satisfy. Same pattern as src/lib/observations/__tests__/load-rows.test.ts.
const m = vi.hoisted(() => ({
  select: vi.fn(),
  where: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock("@/db", () => ({
  db: {
    select: (projection: unknown) => {
      m.select(projection);
      return {
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: (w: unknown) => {
                m.where(w);
                return { limit: () => Promise.resolve(m.rows) };
              },
            }),
          }),
        }),
      };
    },
  },
}));
vi.mock("@/lib/visibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visibility")>()),
  resolveVisibleAdvisorIds: vi.fn().mockResolvedValue(new Set(["user_1"])),
}));

import { searchHouseholds } from "../client-search";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

beforeEach(() => {
  m.select.mockReset();
  m.where.mockReset();
  m.rows = [];
});

describe("searchHouseholds", () => {
  it("labels a household that has a planning client", async () => {
    m.rows = [{
      householdId: "hh1", clientId: "c1", householdName: "Mueller",
      contactRole: "primary", contactFirstName: "Dan", contactLastName: "Mueller",
    }];
    const out = await searchHouseholds("mue", "org_1", { userId: "user_1", orgRole: "org:member" });
    expect(out).toEqual([{
      householdId: "hh1", clientId: "c1", householdTitle: "Mueller", hasPlan: true,
    }]);
  });

  it("returns a prospect household with no planning client", async () => {
    m.rows = [{
      householdId: "hh2", clientId: null, householdName: "Okafor",
      contactRole: "primary", contactFirstName: "Ada", contactLastName: "Okafor",
    }];
    const out = await searchHouseholds("oka", "org_1", { userId: "user_1", orgRole: "org:member" });
    expect(out).toEqual([{
      householdId: "hh2", clientId: null, householdTitle: "Okafor", hasPlan: false,
    }]);
  });

  // Mapping-level: proves the returned object never carries a contact field,
  // even when one is present on the joined row. Does not prove the SQL
  // projection itself — the test below ("projects only...") does that.
  it("never emits contact PII", async () => {
    m.rows = [{
      householdId: "hh1", clientId: "c1", householdName: "Mueller",
      contactRole: "primary", contactFirstName: "Dan", contactLastName: "Mueller",
      contactEmail: "dan@example.com",
    }];
    const out = await searchHouseholds("mue", "org_1", { userId: "user_1" });
    expect(JSON.stringify(out)).not.toContain("dan@example.com");
    expect(JSON.stringify(out)).not.toContain("Dan");
  });

  // Finding 3 (query-hygiene review): pins the real `.select({...})`
  // projection so adding a contact column there (e.g. `contactEmail:
  // crmHouseholdContacts.email`) goes red, instead of relying only on the
  // mapping-level test above, which the mocked chain would satisfy even if
  // the real projection leaked a PII column.
  it("projects only householdId, clientId and householdName from the query", async () => {
    m.rows = [];
    await searchHouseholds("mue", "org_1", { userId: "user_1" });
    expect(m.select).toHaveBeenCalledTimes(1);
    expect(Object.keys(m.select.mock.calls[0][0] as object)).toEqual([
      "householdId", "clientId", "householdName",
    ]);
  });

  // Finding 1 (query-hygiene review): the mocked chain used to ignore its
  // own `.where()` argument, so deleting the firm filter, the Trash filter,
  // or the advisor scope from the real query all left this suite green.
  // Rendering the captured WHERE fragment through the real Postgres dialect
  // (no live DB needed) reads the actual SQL `searchHouseholds` builds.
  it("scopes the where clause to this firm, excludes Trash, and applies the advisor scope", async () => {
    m.rows = [];
    await searchHouseholds("mue", "org_1", { userId: "user_1", orgRole: "org:member" });
    expect(m.where).toHaveBeenCalledTimes(1);
    const { sql, params } = render(m.where.mock.calls[0][0]);
    expect(sql).toContain('"crm_households"."firm_id" =');
    expect(sql).toContain('"crm_households"."deleted_at" is null');
    expect(sql).toContain('"crm_households"."advisor_id" in');
    expect(params).toContain("org_1");
    expect(params).toContain("user_1");
  });

  // Finding 1(d): the contacts join multiplies rows per household (primary +
  // spouse); without the dedupe this returns two entries for one household.
  it("dedupes primary + spouse contact rows into one household entry", async () => {
    m.rows = [
      {
        householdId: "hh1", clientId: "c1", householdName: "Mueller",
        contactRole: "primary", contactFirstName: "Dan", contactLastName: "Mueller",
      },
      {
        householdId: "hh1", clientId: "c1", householdName: "Mueller",
        contactRole: "spouse", contactFirstName: "Amy", contactLastName: "Mueller",
      },
    ];
    const out = await searchHouseholds("mue", "org_1", { userId: "user_1" });
    expect(out).toEqual([{
      householdId: "hh1", clientId: "c1", householdTitle: "Mueller", hasPlan: true,
    }]);
  });

  // Finding 2 (query-hygiene review): unlike containsPattern("mue"), a
  // whitespace-only query LIKE-matches nearly every auto-named household
  // ("First Last" shape), enumerating the book. searchClients already
  // guards this with a trim + empty-string short circuit; searchHouseholds
  // must match.
  it("returns no results for a whitespace-only query, without querying the database", async () => {
    const out = await searchHouseholds("   ", "org_1", { userId: "user_1" });
    expect(out).toEqual([]);
    expect(m.select).not.toHaveBeenCalled();
  });
});
