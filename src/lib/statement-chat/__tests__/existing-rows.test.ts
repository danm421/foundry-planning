// src/lib/statement-chat/__tests__/existing-rows.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Column, Param, SQL, getTableColumns, getTableName } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import { findEntity } from "@/domain/forge/detail-fields";
import type { DetailEntity } from "@/domain/forge/detail-fields";

// Only `@/db` is mocked — `@/db/schema` and `drizzle-orm` are real, so the
// query `loadExistingRows` builds is the actual drizzle condition object the
// driver would receive. Following `presentations/story/voice/__tests__/
// repo.test.ts`, the harness does not hand the rows back verbatim: it walks
// the real join and the real `where` against fixture rows. A loader that
// dropped its client filter, joined on the wrong column, or read the wrong
// table would fail these tests rather than pass them.
//
// That matters more here than in most mocked-db tests: the failure this file
// exists to prevent is not a 500, it is a silent cross-tenant read.

type Row = Record<string, unknown>;

/** Fixture rows per POSTGRES table name, reset before each test. */
const fixtures: Record<string, Row[]> = {};

/** The JS property name a drizzle Column occupies on its own table. */
function keyFor(column: Column): string {
  const entry = Object.entries(getTableColumns(column.table)).find(([, c]) => c === column);
  if (!entry) throw new Error(`column ${column.name} not found on ${getTableName(column.table)}`);
  return entry[0];
}

function rowsOf(table: Table): Row[] {
  return fixtures[getTableName(table)] ?? [];
}

/** The single column and single bound value of an `eq(column, value)`. */
function eqColumnAndParam(condition: SQL): { column: Column; value: unknown } {
  const column = condition.queryChunks.find((c): c is Column => c instanceof Column);
  const param = condition.queryChunks.find((c): c is Param => c instanceof Param);
  if (!column || !param) throw new Error("expected eq(column, value)");
  return { column, value: param.value };
}

/** The two columns of an `eq(columnA, columnB)` join condition. */
function eqColumns(condition: SQL): [Column, Column] {
  const columns = condition.queryChunks.filter((c): c is Column => c instanceof Column);
  if (columns.length !== 2) throw new Error("expected eq(column, column)");
  return [columns[0], columns[1]];
}

vi.mock("@/db", () => {
  /**
   * Minimal select builder: `.from()` seeds the base rows, `.innerJoin()`
   * narrows them by a real column-to-column condition, `.where()` applies the
   * real scoping condition and resolves the projected base rows.
   */
  function select(projection: Record<string, Column>) {
    let base: Table | undefined;
    let pairs: Array<{ rows: Map<string, Row> }> = [];

    const chain = {
      from(table: Table) {
        base = table;
        pairs = rowsOf(table).map((r) => ({ rows: new Map([[getTableName(table), r]]) }));
        return chain;
      },
      innerJoin(table: Table, on: SQL) {
        const [left, right] = eqColumns(on);
        const next: typeof pairs = [];
        for (const pair of pairs) {
          for (const joined of rowsOf(table)) {
            const withJoined = new Map(pair.rows).set(getTableName(table), joined);
            const a = withJoined.get(getTableName(left.table))?.[keyFor(left)];
            const b = withJoined.get(getTableName(right.table))?.[keyFor(right)];
            if (a !== undefined && a === b) next.push({ rows: withJoined });
          }
        }
        pairs = next;
        return chain;
      },
      where(condition: SQL) {
        const { column, value } = eqColumnAndParam(condition);
        const kept = pairs.filter(
          (pair) => pair.rows.get(getTableName(column.table))?.[keyFor(column)] === value,
        );
        return Promise.resolve(
          kept.map((pair) => {
            const source = pair.rows.get(getTableName(base!))!;
            return Object.fromEntries(Object.keys(projection).map((key) => [key, source[key]]));
          }),
        );
      },
    };
    return chain;
  }

  return { db: { select } };
});

import { loadExistingRows } from "../existing-rows";

/** A hand-built entity, so a mis-declaration can be tested without editing the map. */
function entity(overrides: Partial<DetailEntity>): DetailEntity {
  return {
    id: "test_entity",
    label: "Test entity",
    tab: "insurance",
    surface: "Test → Add",
    table: "disabilityPolicies",
    routes: {},
    scenarioScoped: false,
    fields: [],
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(fixtures)) delete fixtures[key];
});

describe("loadExistingRows fails closed", () => {
  it("refuses an entity that declares no scope path", async () => {
    await expect(
      loadExistingRows({ entity: entity({ scopePath: undefined }), clientId: "c1" }),
    ).rejects.toThrow(/scopePath/);
  });

  it("refuses an entity naming a table that is not in the schema", async () => {
    await expect(
      loadExistingRows({
        entity: entity({ table: "notARealTable", scopePath: { via: "column" } }),
        clientId: "c1",
      }),
    ).rejects.toThrow(/notARealTable/);
  });

  it("refuses a `via: column` entity whose own table has no clientId", async () => {
    // The exact mis-declaration Task 2's conformance test cannot catch: its
    // column branch only asserts `scopePath` is defined. Reading
    // lifeInsurancePolicies by a clientId it does not have would either error
    // or — worse, had the loader fallen back — return every firm's policies.
    await expect(
      loadExistingRows({
        entity: entity({ table: "lifeInsurancePolicies", scopePath: { via: "column" } }),
        clientId: "c1",
      }),
    ).rejects.toThrow(/clientId/);
  });

  it("refuses a table whose rows it cannot address by a single primary key", async () => {
    await expect(
      loadExistingRows({
        entity: entity({ table: "crmTaskTags", scopePath: { via: "column" } }),
        clientId: "c1",
      }),
    ).rejects.toThrow(/primary key/);
  });

  it("refuses an entity that is both scenario scoped and identity matched", async () => {
    // A scopePath reaches a client, never a scenario, and `accounts.scenarioId`
    // is notNull. For an entity nothing identity-matches the extra scenarios'
    // rows are inert; for one that IS identity-matched they could produce a
    // wrong `exact` that Task 14 would UPDATE. Only that pair is refused.
    await expect(
      loadExistingRows({
        entity: entity({ scopePath: { via: "column" }, scenarioScoped: true, identity: ["name"] }),
        clientId: "c1",
      }),
    ).rejects.toThrow(/scenarioScoped and identity-matched/);
  });

  it("allows scenario scoping when nothing identity-matches the rows", async () => {
    fixtures["disability_policies"] = [{ id: "d1", clientId: "c1", name: "Group LTD" }];

    // `identity: []` is the "non-empty" half of the rule, and the real
    // `life_insurance_policy` (scenarioScoped, no identity) is the live case.
    await expect(
      loadExistingRows({
        entity: entity({ scopePath: { via: "column" }, scenarioScoped: true, identity: [] }),
        clientId: "c1",
      }),
    ).resolves.toHaveLength(1);
    expect(findEntity("life_insurance_policy")!.scenarioScoped).toBe(true);
    expect(findEntity("life_insurance_policy")!.identity).toBeUndefined();
  });

  it("refuses a join through a table that is not in the schema", async () => {
    await expect(
      loadExistingRows({
        entity: entity({
          table: "lifeInsurancePolicies",
          scopePath: { via: "join", through: "notARealTable", on: "accountId" },
        }),
        clientId: "c1",
      }),
    ).rejects.toThrow(/notARealTable/);
  });

  it("refuses a join whose `on` names a column the entity table does not have", async () => {
    await expect(
      loadExistingRows({
        entity: entity({
          table: "lifeInsurancePolicies",
          scopePath: { via: "join", through: "accounts", on: "clientId" },
        }),
        clientId: "c1",
      }),
    ).rejects.toThrow(/clientId/);
  });
});

describe("loadExistingRows scopes by the declared path", () => {
  it("reads a `via: column` entity straight off its own clientId", async () => {
    fixtures["disability_policies"] = [
      { id: "d1", clientId: "c1", name: "Group LTD", carrier: "Unum" },
      { id: "d2", clientId: "OTHER-FIRM", name: "Someone else's LTD", carrier: "Unum" },
    ];

    const rows = await loadExistingRows({
      entity: findEntity("disability_policy")!,
      clientId: "c1",
    });

    expect(rows.map((r) => r.id)).toEqual(["d1"]);
    expect(rows[0].values.name).toBe("Group LTD");
  });

  it("reads a `via: join` entity through its parent account's clientId", async () => {
    // lifeInsurancePolicies has NO clientId: the row hangs off accountId and
    // only `accounts.clientId` says whose it is.
    fixtures["life_insurance_policies"] = [
      { accountId: "a1", carrier: "Northwestern" },
      { accountId: "a2", carrier: "Another firm's carrier" },
      { accountId: "a3", carrier: "Orphaned policy" },
    ];
    fixtures["accounts"] = [
      { id: "a1", clientId: "c1", name: "Term Life 20" },
      { id: "a2", clientId: "OTHER-FIRM", name: "Not ours" },
    ];

    const rows = await loadExistingRows({
      entity: findEntity("life_insurance_policy")!,
      clientId: "c1",
    });

    // Only a1 survives: a2 belongs to another client, a3 has no account at all.
    expect(rows.map((r) => r.id)).toEqual(["a1"]);
    expect(rows[0].values.carrier).toBe("Northwestern");
  });

  it("addresses a life policy by accountId, its actual primary key", async () => {
    fixtures["life_insurance_policies"] = [{ accountId: "a1", carrier: "Northwestern" }];
    fixtures["accounts"] = [{ id: "a1", clientId: "c1" }];

    const rows = await loadExistingRows({
      entity: findEntity("life_insurance_policy")!,
      clientId: "c1",
    });

    // A loader that hardcoded `columns.id` would find no id column here.
    expect(rows[0].id).toBe("a1");
    expect(rows[0].values).not.toHaveProperty("id");
  });

  it("returns no rows for a client with none, rather than every client's", async () => {
    fixtures["disability_policies"] = [{ id: "d2", clientId: "OTHER-FIRM", name: "Not ours" }];

    const rows = await loadExistingRows({
      entity: findEntity("disability_policy")!,
      clientId: "c1",
    });

    expect(rows).toEqual([]);
  });
});
