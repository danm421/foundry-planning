import { describe, it, expect } from "vitest";
import {
  accountFlowOverrides,
  entityFlowOverrides,
  giftSeries,
  notesReceivable,
} from "@/db/schema";
import type { ToggleGroup } from "@/engine/scenario/types";
import {
  copyFlowOverridesToBase,
  copyGiftSeriesToBase,
  resolveToggleGatedNotesOnBase,
} from "../promote-direct-tables";

type Op = { op: string; table: unknown; values?: unknown };

function makeTx(selectRows: Map<unknown, unknown[]>) {
  const ops: Op[] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => selectRows.get(table) ?? [],
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        ops.push({ op: "delete", table });
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        ops.push({ op: "insert", table, values });
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          ops.push({ op: "update", table, values });
        },
      }),
    }),
  };
  return { tx, ops };
}

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
    await copyGiftSeriesToBase(tx as never, { clientId: "c1", scenarioId: "s1", baseScenarioId: "b1" });

    expect(ops.some((o) => o.op === "delete" && o.table === giftSeries)).toBe(true);
    const insert = ops.find((o) => o.op === "insert" && o.table === giftSeries);
    const v = insert!.values as Record<string, unknown>;
    expect(v.scenarioId).toBe("b1");
    expect(v.grantor).toBe("client");
    expect("id" in v).toBe(false);
    expect("createdAt" in v).toBe(false);
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
