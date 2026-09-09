import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Chainable `db.select()` mock, same shape as bindings.test.ts: every step
 * returns the chain and the chain is thenable, so awaiting it shifts the next
 * row-set off `queue`. `where()` keeps its real drizzle condition (only `@/db`
 * is mocked — drizzle-orm and @/db/schema are real), so `compile()` below can
 * prove the predicate actually constrains the query rather than trusting the
 * mock's answer.
 */
let queue: unknown[][] = [];
const selectCall = vi.fn();
const selectWhereArgs: unknown[] = [];

const selectChain = {
  from: () => selectChain,
  innerJoin: () => selectChain,
  where: (cond: unknown) => {
    selectWhereArgs.push(cond);
    return selectChain;
  },
  then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    Promise.resolve(queue.shift() ?? []).then(resolve, reject);
  },
};

vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => {
      selectCall(...a);
      return selectChain;
    },
  },
}));

import { resolveHouseholdNames } from "@/lib/portal/household-names";

const dialect = new PgDialect();
function compile(expr: unknown) {
  return dialect.sqlToQuery(expr as SQL);
}

function contact(
  clientId: string,
  role: "primary" | "spouse",
  firstName: string,
  lastName: string,
) {
  return { clientId, role, firstName, lastName };
}

beforeEach(() => {
  queue = [];
  selectCall.mockClear();
  selectWhereArgs.length = 0;
});

describe("resolveHouseholdNames", () => {
  it("returns an empty map for an empty id list WITHOUT querying", async () => {
    // `inArray(col, [])` is a Postgres error in some drizzle versions and a
    // full-table scan in none of them — either way there is nothing to ask.
    expect(await resolveHouseholdNames([])).toEqual(new Map());
    expect(selectCall).not.toHaveBeenCalled();
  });

  it("names a single-person household from its primary contact", async () => {
    queue = [[contact("client-1", "primary", "John", "Cooper")]];
    const names = await resolveHouseholdNames(["client-1"]);
    expect(names.get("client-1")).toBe("John Cooper");
  });

  it("folds the spouse into the name", async () => {
    queue = [
      [
        contact("client-1", "primary", "John", "Cooper"),
        contact("client-1", "spouse", "Jane", "Cooper"),
      ],
    ];
    expect((await resolveHouseholdNames(["client-1"])).get("client-1")).toBe(
      "John & Jane Cooper",
    );
  });

  it("keeps both surnames when the spouse's differs", async () => {
    queue = [
      [
        contact("client-1", "primary", "John", "Cooper"),
        contact("client-1", "spouse", "Jane", "Whitfield"),
      ],
    ];
    expect((await resolveHouseholdNames(["client-1"])).get("client-1")).toBe(
      "John Cooper & Jane Whitfield",
    );
  });

  it("resolves a BATCH of households in ONE query", async () => {
    // The whole reason this is a helper and not an inline join: the requests
    // route asks about N households at once, and Task 10 asks about more.
    queue = [
      [
        contact("client-1", "primary", "John", "Cooper"),
        contact("client-2", "primary", "Ada", "Byron"),
        contact("client-2", "spouse", "Bo", "Byron"),
      ],
    ];
    const names = await resolveHouseholdNames(["client-1", "client-2"]);
    expect(names.get("client-1")).toBe("John Cooper");
    expect(names.get("client-2")).toBe("Ada & Bo Byron");
    expect(selectCall).toHaveBeenCalledTimes(1);
  });

  it("omits a household with no primary contact rather than inventing a name", async () => {
    // A spouse row alone cannot name a household — deriveHouseholdNameFromContacts
    // returns null. The caller renders its own fallback.
    queue = [[contact("client-1", "spouse", "Jane", "Cooper")]];
    expect((await resolveHouseholdNames(["client-1"])).has("client-1")).toBe(false);
  });

  it("omits an id the query returned no contacts for", async () => {
    queue = [[contact("client-1", "primary", "John", "Cooper")]];
    const names = await resolveHouseholdNames(["client-1", "client-missing"]);
    expect(names.has("client-missing")).toBe(false);
  });

  it("binds the requested client ids into the WHERE, not just any household", async () => {
    // Mutation guard: dropping the inArray predicate would still pass every
    // assertion above, because the mock answers regardless of the condition.
    queue = [[contact("client-1", "primary", "John", "Cooper")]];
    await resolveHouseholdNames(["client-1", "client-2"]);
    const { sql, params } = compile(selectWhereArgs[0]);
    expect(params).toContain("client-1");
    expect(params).toContain("client-2");
    expect(sql).toContain("crm_household_contacts");
  });

  it("restricts the read to name-bearing roles", async () => {
    // Dependents and 'other' contacts never name a household — and a portal
    // client must not be shown a CPA's name as their own household.
    queue = [[contact("client-1", "primary", "John", "Cooper")]];
    await resolveHouseholdNames(["client-1"]);
    const { params } = compile(selectWhereArgs[0]);
    expect(params).toContain("primary");
    expect(params).toContain("spouse");
  });
});
