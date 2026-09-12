// src/lib/scenario/__tests__/create-with-clone.test.ts
//
// Pins the one thing a new scenario must inherit that is NOT a delta:
// `gift_series`.
//
// Every other piece of the client's plan (accounts, incomes, one-time gifts)
// lives in a client-scoped table the loader reads unfiltered, so a brand-new
// scenario shows it automatically. `gift_series` is the exception — it is
// scenario-PARTITIONED (`load-client-data.ts` filters it by scenarioId), so a
// scenario whose partition was never seeded projects as though the client's
// recurring gifting stopped. Promoting that scenario then makes it permanent:
// `copyGiftSeriesToBase` clears base's rows and copies the scenario's empty set.
//
// That is why "start empty" seeds from base too. Empty means no CHANGES, not a
// client with no plan — and it is the create dialog's DEFAULT option.
//
// Fake tx rather than a real DB: the evidence here is WHICH partition is read
// and WHAT is written, both of which a captured statement shows exactly. The
// WHERE predicates are captured and rendered, not discarded — they are the only
// proof the clone reads the source scenario's partition and not some other.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { giftSeries, scenarios } from "@/db/schema";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const BASE_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "44444444-4444-4444-8444-444444444444";

type Op = { op: "select" | "insert"; table: unknown; values?: unknown; where?: unknown };

/** Rows the fake `select()` hands back, keyed by table. The WHERE predicate is
 *  captured rather than applied — the tests assert on it directly, which is
 *  stronger than a fake that silently filters. */
let rowsByTable = new Map<unknown, unknown[]>();
let ops: Op[] = [];

const tx = {
  // Zero-arg on purpose: the helper calls select() both bare and with a column
  // map, and an unused named param is a lint warning for no gain.
  select: () => ({
    from: (table: unknown) => ({
      where: async (predicate: unknown) => {
        ops.push({ op: "select", table, where: predicate });
        return rowsByTable.get(table) ?? [];
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      ops.push({ op: "insert", table, values });
      // Only the scenarios insert reads its result back.
      const returned =
        table === scenarios
          ? [{ id: NEW_ID, ...(values as Record<string, unknown>) }]
          : [];
      return Object.assign(Promise.resolve(returned), {
        returning: async () => returned,
      });
    },
  }),
};

vi.mock("@/db", () => ({
  db: {
    transaction: async (cb: (t: unknown) => Promise<unknown>) => await cb(tx),
  },
}));

const { createScenarioWithClone } = await import("../create-with-clone");

/** A captured WHERE as readable SQL + params. Comparing drizzle SQL objects
 *  with toEqual prints thousands of lines of column metadata on failure and
 *  hides the very thing under test; this prints one line. */
const dialect = new PgDialect();
const paramsOf = (predicate: unknown): unknown[] =>
  dialect.sqlToQuery(predicate as SQL).params;

/** One fully-populated series row. Every optional column is set on purpose: a
 *  clone that rebuilds the row from a hand-written column list would drop them
 *  silently, and the advisor would never see it. */
const seriesRow = () => ({
  id: "99999999-9999-4999-8999-999999999999",
  clientId: CLIENT_ID,
  scenarioId: BASE_ID,
  grantor: "client" as const,
  recipientEntityId: null,
  recipientFamilyMemberId: "55555555-5555-4555-8555-555555555555",
  recipientExternalBeneficiaryId: null,
  startYear: 2026,
  startYearRef: "retirement" as const,
  endYear: 2035,
  endYearRef: null,
  annualAmount: "18000.00",
  valuationDiscount: "0.3000",
  amountMode: "fixed" as const,
  inflationAdjust: true,
  useCrummeyPowers: true,
  notes: "Annual exclusion gifting to the kids",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
});

const seriesInserts = () => ops.filter((o) => o.op === "insert" && o.table === giftSeries);
const seriesSelect = () => ops.find((o) => o.op === "select" && o.table === giftSeries);

beforeEach(() => {
  ops = [];
  rowsByTable = new Map<unknown, unknown[]>([
    // The fake ignores the predicate, so seed only what a real WHERE would
    // return: the base-case lookup and the source lookup both resolve to one row.
    [scenarios, [{ id: BASE_ID }]],
    [giftSeries, [seriesRow()]],
  ]);
});

describe("createScenarioWithClone — gift_series", () => {
  it("seeds a 'start empty' scenario from the client's base partition", async () => {
    await createScenarioWithClone({ clientId: CLIENT_ID, name: "Empty", source: { kind: "empty" } });

    const read = seriesSelect();
    expect(read, "no gift_series was read at all").toBeDefined();
    expect(paramsOf(read!.where)).toEqual([CLIENT_ID, BASE_ID]);

    const inserts = seriesInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toHaveLength(1);
  });

  it("seeds a 'base case' scenario from the base partition", async () => {
    await createScenarioWithClone({ clientId: CLIENT_ID, name: "Roth", source: { kind: "base" } });

    expect(paramsOf(seriesSelect()!.where)).toEqual([CLIENT_ID, BASE_ID]);
    expect(seriesInserts()).toHaveLength(1);
  });

  it("seeds a duplicated scenario from THAT scenario's partition, not base's", async () => {
    rowsByTable.set(scenarios, [{ id: SOURCE_ID }]);

    await createScenarioWithClone({
      clientId: CLIENT_ID,
      name: "Copy of Roth",
      source: { kind: "scenario", sourceId: SOURCE_ID },
    });

    expect(paramsOf(seriesSelect()!.where)).toEqual([CLIENT_ID, SOURCE_ID]);
  });

  it("re-scopes each cloned row to the new scenario with a fresh id, keeping every other column", async () => {
    await createScenarioWithClone({ clientId: CLIENT_ID, name: "Gifting", source: { kind: "base" } });

    const [cloned] = seriesInserts()[0].values as Record<string, unknown>[];

    expect(cloned.scenarioId).toBe(NEW_ID);
    // Fresh id + timestamps: the column defaults must apply, or the insert
    // collides with the source row's PK.
    expect(cloned).not.toHaveProperty("id");
    expect(cloned).not.toHaveProperty("createdAt");
    expect(cloned).not.toHaveProperty("updatedAt");

    const { id: _id, createdAt: _c, updatedAt: _u, scenarioId: _s, ...carried } = seriesRow();
    void _id; void _c; void _u; void _s;
    expect(cloned).toMatchObject(carried);
  });

  it("looks but writes nothing when the source partition is empty", async () => {
    rowsByTable.set(giftSeries, []);

    await createScenarioWithClone({ clientId: CLIENT_ID, name: "Empty", source: { kind: "empty" } });

    // Both halves, or the test is green before the fix as well as after and so
    // pins nothing: it must LOOK (the read happens) and then NOT write.
    expect(seriesSelect()).toBeDefined();
    expect(seriesInserts()).toHaveLength(0);
  });
});
