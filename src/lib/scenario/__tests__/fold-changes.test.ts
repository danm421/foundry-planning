import { describe, it, expect } from "vitest";
import type { OpType, ScenarioChange, TargetKind } from "@/engine/scenario/types";
import { foldChanges } from "../fold-changes";

let n = 0;
function ch(
  op: OpType,
  kind: TargetKind,
  id: string,
  payload: unknown,
  extra: Partial<ScenarioChange> = {},
): ScenarioChange {
  n += 1;
  return {
    id: `row-${n}`,
    scenarioId: "s1",
    opType: op,
    targetKind: kind,
    targetId: id,
    payload,
    toggleGroupId: null,
    orderIndex: n,
    ...extra,
  };
}

describe("foldChanges", () => {
  it("edit folds into a saved add", () => {
    const saved = [
      ch("add", "expense", "e1", { id: "e1", annualAmount: 100, name: "G" }, { toggleGroupId: "g1", orderIndex: 7 }),
    ];
    const out = foldChanges(saved, [ch("edit", "expense", "e1", { annualAmount: { from: 100, to: 150 } })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: saved[0].id,
      opType: "add",
      toggleGroupId: "g1",
      orderIndex: 7,
      payload: { id: "e1", annualAmount: 150, name: "G" },
    });
  });

  it("an edit folded into a saved add takes the edit's toggle group", () => {
    const saved = [ch("add", "expense", "e1", { id: "e1", annualAmount: 100 })];
    const out = foldChanges(saved, [
      ch("edit", "expense", "e1", { annualAmount: { from: 100, to: 150 } }, { toggleGroupId: "g2" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ opType: "add", toggleGroupId: "g2", payload: { annualAmount: 150 } });
  });

  it("two edits merge field by field, later wins", () => {
    const saved = [ch("edit", "income", "i1", { a: { from: 1, to: 2 }, b: { from: 1, to: 5 } })];
    const out = foldChanges(saved, [ch("edit", "income", "i1", { a: { from: 1, to: 3 } })]);
    expect(out).toHaveLength(1);
    expect(out[0].opType).toBe("edit");
    expect(out[0].payload).toEqual({ a: { from: 1, to: 3 }, b: { from: 1, to: 5 } });
  });

  it("remove cancels a saved add and its edits", () => {
    const saved = [
      ch("add", "account", "a1", { id: "a1" }),
      ch("edit", "account", "a1", { x: { from: 1, to: 2 } }),
    ];
    expect(foldChanges(saved, [ch("remove", "account", "a1", null)])).toEqual([]);
  });

  it("remove of a gift keeps the marker", () => {
    const saved = [ch("add", "gift", "g1", { id: "g1" })];
    const out = foldChanges(saved, [ch("remove", "gift", "g1", null)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ opType: "remove", targetKind: "gift", targetId: "g1" });
  });

  it("remove supersedes a saved edit", () => {
    const saved = [ch("edit", "income", "i1", { a: { from: 1, to: 2 } })];
    const out = foldChanges(saved, [ch("remove", "income", "i1", null)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ opType: "remove", targetKind: "income", targetId: "i1" });
  });

  it("add replaces a saved add on the same target", () => {
    const saved = [ch("add", "expense", "e1", { id: "e1", annualAmount: 1 })];
    const out = foldChanges(saved, [ch("add", "expense", "e1", { id: "e1", annualAmount: 2 })]);
    expect(out).toHaveLength(1);
    expect(out[0].payload).toEqual({ id: "e1", annualAmount: 2 });
  });

  it("extra rows append after saved ones with increasing orderIndex", () => {
    const saved = [ch("edit", "income", "i1", { a: { from: 1, to: 2 } }, { orderIndex: 4 })];
    const out = foldChanges(saved, [
      ch("edit", "income", "i2", { a: { from: 1, to: 2 } }),
      ch("add", "expense", "e9", { id: "e9" }),
    ]);
    expect(out.map((c) => c.targetId)).toEqual(["i1", "i2", "e9"]);
    expect(out[1].orderIndex).toBeGreaterThan(4);
    expect(out[2].orderIndex).toBeGreaterThan(out[1].orderIndex);
  });

  it("no extras returns saved unchanged (same array reference)", () => {
    const saved = [ch("remove", "income", "i1", null)];
    expect(foldChanges(saved, [])).toBe(saved);
  });
});
