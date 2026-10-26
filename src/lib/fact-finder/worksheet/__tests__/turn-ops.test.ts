import { describe, expect, it } from "vitest";
import { FactFinderOpError, type OpContext } from "../../ops";
import { emptyFactFinderState } from "../../state";
import { applyTurnOps } from "../turn-ops";

const ctx: OpContext = { by: "chat", now: "2026-10-26T12:00:00.000Z", newId: () => "x" };

describe("applyTurnOps", () => {
  it("applies worksheet and staging ops in order", () => {
    const next = applyTurnOps(
      emptyFactFinderState(),
      [
        { layer: "staging", op: { op: "addRow", sectionId: "cash", rowId: "c1", cells: { accountName: "Chase" } } },
        { layer: "ws", op: { op: "createTable", tableId: "t1", title: "Mine", columns: [{ id: "a", header: "A" }] } },
        { layer: "ws", op: { op: "addRows", tableId: "t1", rows: [{ id: "r1", cells: { a: "x" }, ref: { rowId: "c1" } }] } },
      ],
      ctx,
    );
    expect(next.sections.cash.map((r) => r.id)).toEqual(["c1"]);
    expect(next.worksheet.tables[0].rows[0].ref?.rowId).toBe("c1");
    expect(next.worksheet.derived).toBeUndefined();
  });

  it("a bad staging op throws and leaves both layers unchanged", () => {
    const start = emptyFactFinderState();
    const before = JSON.stringify(start);
    expect(() =>
      applyTurnOps(
        start,
        [
          { layer: "ws", op: { op: "createTable", tableId: "t1", title: "Mine", columns: [{ id: "a", header: "A" }] } },
          { layer: "staging", op: { op: "setCell", sectionId: "cash", rowId: "nope", columnId: "accountName", value: "x" } },
        ],
        ctx,
      ),
    ).toThrow(FactFinderOpError);
    expect(JSON.stringify(start)).toBe(before);
  });
});
