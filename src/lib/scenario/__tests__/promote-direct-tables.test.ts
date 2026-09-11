import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  accountFlowOverrides,
  entityFlowOverrides,
  giftSeries,
  notesReceivable,
} from "@/db/schema";
import type { ToggleGroup } from "@/engine/scenario/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import {
  copyFlowOverridesToBase,
  copyGiftSeriesToBase,
  resolveToggleGatedNotesOnBase,
} from "../promote-direct-tables";

type Op = { op: string; table: unknown; values?: unknown; where?: unknown };

/** The WHERE predicate is CAPTURED, not discarded: it is the only evidence that
 *  a statement is scoped to the right client AND the right scenario, and the
 *  gift_series step writes to the PROMOTED scenario's partition and to base in
 *  the same transaction — an unscoped write would silently hit both. */
function makeTx(
  selectRows: Map<unknown, unknown[]>,
  /** Rows the next UPDATE ... RETURNING reports as matched. Empty = no row,
   *  which is how the series upsert falls through to its INSERT. */
  updateMatches: { id: string }[] = [],
) {
  const ops: Op[] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => selectRows.get(table) ?? [],
      }),
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        ops.push({ op: "delete", table, where: predicate });
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        ops.push({ op: "insert", table, values });
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (predicate: unknown) => {
          ops.push({ op: "update", table, values, where: predicate });
          // Awaitable for the callers that ignore the result, and
          // `.returning()`-able for the upsert that needs to know if it matched.
          return Object.assign(Promise.resolve(updateMatches), {
            returning: async () => updateMatches,
          });
        },
      }),
    }),
  };
  return { tx, ops };
}

/** A captured WHERE predicate as readable SQL + params. The drizzle SQL objects
 *  compare fine with `toEqual`, but a failure prints thousands of lines of
 *  column metadata and hides the very thing under test — this prints one line. */
const dialect = new PgDialect();
function renderWhere(predicate: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(predicate as SQL);
  return { sql: q.sql, params: q.params };
}

/** No series changes at all — the shape every pre-existing caller passes. */
const NO_SERIES_OPS = {
  upserts: [] as { id: string; draft: EstateFlowGift }[],
  removes: [] as string[],
  idRemap: new Map<string, string>(),
};

describe("copyFlowOverridesToBase", () => {
  it("clears base rows and re-scopes the scenario's entity flow overrides to base", async () => {
    const rows = new Map<unknown, unknown[]>([
      [entityFlowOverrides, [{ id: "e1", scenarioId: "s1", entityId: "ent1", year: 2030, incomeAmount: "100" }]],
      [accountFlowOverrides, []],
    ]);
    const { tx, ops } = makeTx(rows);
    await copyFlowOverridesToBase(tx as never, { clientId: "c1", scenarioId: "s1", baseScenarioId: "b1" });

    expect(ops.some((o) => o.op === "delete" && o.table === entityFlowOverrides)).toBe(true);
    const insert = ops.find((o) => o.op === "insert" && o.table === entityFlowOverrides);
    expect(insert).toBeDefined();
    const v = insert!.values as Record<string, unknown>;
    expect(v.scenarioId).toBe("b1");
    expect(v.entityId).toBe("ent1");
    expect("id" in v).toBe(false); // generated fresh
  });
});

describe("copyGiftSeriesToBase", () => {
  it("clears base gift_series and re-scopes the scenario's rows to base", async () => {
    const rows = new Map<unknown, unknown[]>([
      [giftSeries, [{ id: "g1", clientId: "c1", scenarioId: "s1", grantor: "client", annualAmount: "1000", createdAt: new Date(), updatedAt: new Date() }]],
    ]);
    const { tx, ops } = makeTx(rows);
    await copyGiftSeriesToBase(
      tx as never,
      { clientId: "c1", scenarioId: "s1", baseScenarioId: "b1" },
      NO_SERIES_OPS,
    );

    expect(ops.some((o) => o.op === "delete" && o.table === giftSeries)).toBe(true);
    const insert = ops.find((o) => o.op === "insert" && o.table === giftSeries);
    const v = insert!.values as Record<string, unknown>;
    expect(v.scenarioId).toBe("b1");
    expect(v.grantor).toBe("client");
    expect("id" in v).toBe(false);
    expect("createdAt" in v).toBe(false);
  });

  // ── The series step (RULING 77 + 81) ───────────────────────────────────────
  //
  // A recurring series the SOLVER writes is a `gift` scenario change carrying a
  // series draft, but `gift_series` is scenario-PARTITIONED and is not a
  // TargetKind. Promotion folds those changes into the PROMOTED SCENARIO's own
  // partition and then lets the copy below carry the result into base — the
  // same composition (`partition rows + gift-change overlay`) the projection
  // does, in the same order. Writing to BASE instead could not work: `reScope`
  // drops the row id, so base's copies have fresh uuids that no change's
  // targetId can name.
  const CTX = { clientId: "c1", scenarioId: "s1", baseScenarioId: "b1" };

  const seriesDraft: EstateFlowGift = {
    kind: "series",
    id: "gs1",
    startYear: 2027,
    endYear: 2031,
    annualAmount: 19_000,
    amountMode: "annual_exclusion",
    inflationAdjust: true,
    grantor: "spouse",
    recipient: { kind: "entity", id: "trust-1" },
    crummey: true,
    valuationDiscount: 0.3,
  };

  /** One partition row, so the copy half has something to carry into base. */
  const partitionRows = () =>
    new Map<unknown, unknown[]>([
      [
        giftSeries,
        [
          {
            id: "gs1",
            clientId: "c1",
            scenarioId: "s1",
            grantor: "spouse",
            annualAmount: "19000.00",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ],
    ]);

  it("writes the scenario's partition BEFORE the base delete and copy", async () => {
    // THE ORDER IS THE WHOLE DESIGN. It lives inside one function precisely so
    // that no later edit can reorder two adjacent calls in the orchestrator: a
    // partition write that landed AFTER the copy would never reach base at all.
    const { tx, ops } = makeTx(partitionRows());
    await copyGiftSeriesToBase(tx as never, CTX, {
      upserts: [{ id: "gs1", draft: seriesDraft }],
      removes: ["gs-deleted"],
      idRemap: new Map(),
    });

    // remove → upsert (update, then insert because nothing matched) → base
    // delete → base copy.
    expect(ops.map((o) => o.op)).toEqual([
      "delete",
      "update",
      "insert",
      "delete",
      "insert",
    ]);
    // Everything before index 3 is partition work, scoped to the PROMOTED
    // scenario; index 3 is where base is touched for the first time.
    expect(renderWhere(ops[3].where)).toEqual({
      sql: '("gift_series"."client_id" = $1 and "gift_series"."scenario_id" = $2)',
      params: ["c1", "b1"],
    });
    expect((ops[2].values as Record<string, unknown>).scenarioId).toBe("s1");
    expect((ops[4].values as Record<string, unknown>).scenarioId).toBe("b1");
  });

  it("omits notes / startYearRef / endYearRef and carries what the draft does represent", async () => {
    // RULING 61's lesson, applied before it bites a second table. The draft
    // cannot represent a note or a milestone anchor, so an UPDATE that wrote
    // them as null would erase the advisor's own. An absent key takes the
    // column default on INSERT and leaves the column alone on UPDATE.
    const absent = ["notes", "startYearRef", "endYearRef"];
    const carried = {
      grantor: "spouse",
      recipientEntityId: "trust-1",
      recipientFamilyMemberId: null,
      recipientExternalBeneficiaryId: null,
      startYear: 2027,
      endYear: 2031,
      annualAmount: "19000", // numeric column, stringified
      amountMode: "annual_exclusion",
      inflationAdjust: true,
      useCrummeyPowers: true,
      valuationDiscount: "0.3", // represented by the draft → a null here is intent
    };

    // (a) nothing in the partition yet → the INSERT branch.
    const fresh = makeTx(new Map());
    await copyGiftSeriesToBase(fresh.tx as never, CTX, {
      upserts: [{ id: "gs1", draft: seriesDraft }],
      removes: [],
      idRemap: new Map(),
    });
    const inserted = fresh.ops.find((o) => o.op === "insert")!
      .values as Record<string, unknown>;
    for (const key of absent) expect(key in inserted).toBe(false);
    expect(inserted).toMatchObject(carried);
    expect(inserted.id).toBe("gs1"); // the id the change names

    // (b) the row already exists → the UPDATE branch, where the omission is
    // load-bearing rather than merely equivalent to the column default.
    const existing = makeTx(partitionRows(), [{ id: "gs1" }]);
    await copyGiftSeriesToBase(existing.tx as never, CTX, {
      upserts: [{ id: "gs1", draft: seriesDraft }],
      removes: [],
      idRemap: new Map(),
    });
    const set = existing.ops.find((o) => o.op === "update")!
      .values as Record<string, unknown>;
    for (const key of absent) expect(key in set).toBe(false);
    expect(set).toMatchObject(carried);
    expect("id" in set).toBe(false); // the id is the selector, never the payload
    // It matched, so nothing falls through to an INSERT of a second row.
    expect(existing.ops.filter((o) => o.op === "insert")).toHaveLength(1); // the base copy only
  });

  it("remaps a recipient the same promote just created", async () => {
    // A series to a trust the SAME scenario created names it by the synthetic
    // id the change invented; the real `entities` row exists only under the
    // uuid the executor's insert generated moments earlier, in this same
    // transaction. Without the remap the FK rejects it and the whole promote
    // rolls back.
    const { tx, ops } = makeTx(new Map());
    await copyGiftSeriesToBase(tx as never, CTX, {
      upserts: [
        {
          id: "gs1",
          draft: { ...seriesDraft, recipient: { kind: "entity", id: "e-syn" } },
        },
      ],
      removes: [],
      idRemap: new Map([["e-syn", "db-1"]]),
    });
    const inserted = ops.find((o) => o.op === "insert")!.values as Record<string, unknown>;
    expect(inserted.recipientEntityId).toBe("db-1");
    expect(inserted.recipientEntityId).not.toBe("e-syn");
  });

  it("scopes every partition write to the promoting client AND the promoted scenario", async () => {
    // ORG SCOPING. These statements key on an id the CHANGE names, which is
    // advisor-supplied data — so an unscoped update or delete would reach a row
    // in base, in a sibling scenario, or in another firm's client entirely.
    const { tx, ops } = makeTx(new Map(), [{ id: "gs1" }]);
    await copyGiftSeriesToBase(tx as never, CTX, {
      upserts: [
        {
          // A payload that LIES about its scope: the values written must come
          // from ctx, never from the change.
          id: "gs1",
          draft: { ...seriesDraft, clientId: "other-client", scenarioId: "b1" } as EstateFlowGift,
        },
      ],
      removes: ["gs-deleted"],
      idRemap: new Map(),
    });

    // Spelled out rather than compared against a helper's own output, so the
    // client and scenario terms are asserted concretely: this fails if anyone
    // drops either one, or swaps the pair for an unscoped `onConflictDoUpdate`.
    const scoped = (id: string) => ({
      sql:
        '("gift_series"."id" = $1 and "gift_series"."client_id" = $2 and ' +
        '"gift_series"."scenario_id" = $3)',
      params: [id, "c1", "s1"],
    });
    expect(ops[0].op).toBe("delete");
    expect(renderWhere(ops[0].where)).toEqual(scoped("gs-deleted"));
    expect(ops[1].op).toBe("update");
    expect(renderWhere(ops[1].where)).toEqual(scoped("gs1"));
    const set = ops[1].values as Record<string, unknown>;
    expect(set.clientId).toBe("c1");
    expect(set.scenarioId).toBe("s1");
  });
});

describe("resolveToggleGatedNotesOnBase", () => {
  const groups: ToggleGroup[] = [
    { id: "g1", scenarioId: "s1", name: "On", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
    { id: "g2", scenarioId: "s1", name: "Off", defaultOn: false, requiresGroupId: null, orderIndex: 1 },
  ];

  it("nulls the gate on active notes and deletes inactive/foreign-gated notes", async () => {
    const rows = new Map<unknown, unknown[]>([
      [notesReceivable, [
        { id: "n1", toggleGroupId: "g1" }, // active → keep, null the gate
        { id: "n2", toggleGroupId: "g2" }, // inactive → delete
        { id: "n3", toggleGroupId: "foreign" }, // not in S's groups → delete
      ]],
    ]);
    const { tx, ops } = makeTx(rows);
    const res = await resolveToggleGatedNotesOnBase(tx as never, {
      clientId: "c1",
      baseScenarioId: "b1",
      toggleState: {},
      groups,
    });

    expect(res).toEqual({ kept: 1, dropped: 2 });
    const update = ops.find((o) => o.op === "update");
    expect((update!.values as Record<string, unknown>).toggleGroupId).toBeNull();
    expect(ops.filter((o) => o.op === "delete")).toHaveLength(2);
  });
});
