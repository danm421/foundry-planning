import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const m = vi.hoisted(() => ({ where: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          m.where(w);
          return { orderBy: async () => m.rows };
        },
      }),
    }),
  },
}));

import { loadClientObservationRows } from "../load-rows";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);
const CLIENT = "c1a11111-2222-4333-8444-555555555555";

beforeEach(() => {
  m.where.mockReset();
  m.rows = [];
});

describe("loadClientObservationRows", () => {
  it("reads this client's CLIENT-audience rows only — an advisor row never prints", async () => {
    await loadClientObservationRows(CLIENT);
    expect(m.where).toHaveBeenCalledTimes(1);
    const { sql, params } = render(m.where.mock.calls[0][0]);
    expect(sql).toContain('"plan_observations"."client_id" =');
    expect(sql).toContain('"plan_observations"."audience" =');
    expect(params).toEqual([CLIENT, "client"]);
  });

  it("returns the nine columns the view-model reads, as the row", async () => {
    m.rows = [{
      section: "observation", topic: "tax", title: null, body: "x", status: "open",
      owner: null, priority: null, targetDate: null, sortOrder: 0,
    }];
    const rows = await loadClientObservationRows(CLIENT);
    expect(rows).toEqual(m.rows);
  });
});
