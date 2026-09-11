import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Chainable `db.select()` mock, same shape as household-names.test.ts: every
 * step returns the chain and the chain is thenable, so awaiting it shifts the
 * next row-set off `queue`. `where()` keeps its real drizzle condition (only
 * `@/db` is mocked — drizzle-orm and @/db/schema are real), so `compile()` can
 * prove the predicate actually constrains the query.
 */
let queue: unknown[][] = [];
const selectCall = vi.fn();
const selectWhereArgs: unknown[] = [];

const selectChain = {
  from: () => selectChain,
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

import { getFirmDisplayNames } from "@/lib/branding/db";

const dialect = new PgDialect();
function compile(expr: unknown) {
  return dialect.sqlToQuery(expr as SQL);
}

beforeEach(() => {
  queue = [];
  selectCall.mockClear();
  selectWhereArgs.length = 0;
});

describe("getFirmDisplayNames", () => {
  it("returns an empty map for an empty id list WITHOUT querying", async () => {
    expect(await getFirmDisplayNames([])).toEqual(new Map());
    expect(selectCall).not.toHaveBeenCalled();
  });

  it("reads a BATCH of firms in ONE query, constrained to the ids asked for", async () => {
    queue = [
      [
        { firmId: "org_a", displayName: "Northgate Advisors" },
        { firmId: "org_b", displayName: "Halyard Wealth" },
      ],
    ];
    const names = await getFirmDisplayNames(["org_a", "org_b"]);
    expect(names.get("org_a")).toBe("Northgate Advisors");
    expect(names.get("org_b")).toBe("Halyard Wealth");
    expect(selectCall).toHaveBeenCalledTimes(1);

    const q = compile(selectWhereArgs[0]);
    expect(q.sql).toMatch(/"firm_id" in/i);
    expect(q.params).toEqual(["org_a", "org_b"]);
  });

  it("asks about each firm ONCE even when several rows name the same one", async () => {
    // The requests screen commonly lists two households at one firm.
    queue = [[{ firmId: "org_a", displayName: "Northgate Advisors" }]];
    await getFirmDisplayNames(["org_a", "org_a", "org_a"]);
    expect(compile(selectWhereArgs[0]).params).toEqual(["org_a"]);
  });

  it("OMITS a firm with no display_name rather than handing back a blank", async () => {
    // This absent-entry contract is what lets the access-request screen fall
    // back to a neutral label instead of rendering an empty firm name.
    queue = [
      [
        { firmId: "org_a", displayName: null },
        { firmId: "org_b", displayName: "" },
        { firmId: "org_c", displayName: "Halyard Wealth" },
      ],
    ];
    const names = await getFirmDisplayNames(["org_a", "org_b", "org_c"]);
    expect(names.has("org_a")).toBe(false);
    expect(names.has("org_b")).toBe(false);
    expect(names.get("org_c")).toBe("Halyard Wealth");
  });
});
