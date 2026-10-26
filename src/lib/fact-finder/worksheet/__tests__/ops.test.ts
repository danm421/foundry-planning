import { describe, expect, it } from "vitest";
import { applyWsOps, columnByHeader, emptyWorksheet, findTable, WorksheetOpError } from "../ops";
import type { Worksheet, WsColumn } from "../types";

const cols: WsColumn[] = [
  { id: "name", header: "Account" },
  { id: "value", header: "Value" },
];

function base(): Worksheet {
  return applyWsOps(emptyWorksheet(), [
    { op: "createTable", tableId: "t1", title: "Accounts", columns: cols },
    { op: "addRows", tableId: "t1", rows: [{ id: "r1", cells: { name: "IRA", value: "10" } }] },
  ]);
}

describe("worksheet ops", () => {
  it("createTable adds a table at the end; a duplicate tableId throws", () => {
    const ws = applyWsOps(base(), [{ op: "createTable", tableId: "t2", title: "Debts", columns: [] }]);
    expect(ws.tables.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(() => applyWsOps(ws, [{ op: "createTable", tableId: "t2", title: "X", columns: [] }])).toThrow(
      WorksheetOpError,
    );
  });

  it('two columns with the same header (case-insensitive) throw "A table can\'t have two \\"Value\\" columns."', () => {
    expect(() =>
      applyWsOps(emptyWorksheet(), [
        {
          op: "createTable",
          tableId: "t",
          title: "T",
          columns: [
            { id: "a", header: "Value" },
            { id: "b", header: " value " },
          ],
        },
      ]),
    ).toThrow('A table can\'t have two "Value" columns.');
  });

  it("setColumns keeps cells of kept column ids and drops the rest", () => {
    const ws = applyWsOps(base(), [
      { op: "setColumns", tableId: "t1", columns: [{ id: "name", header: "Name" }, { id: "x", header: "X" }] },
    ]);
    expect(findTable(ws, "t1").rows[0].cells).toEqual({ name: "IRA" });
  });

  it("addRows rejects a cell keyed by an unknown column id", () => {
    expect(() =>
      applyWsOps(base(), [{ op: "addRows", tableId: "t1", rows: [{ id: "r2", cells: { nope: "1" } }] }]),
    ).toThrow(WorksheetOpError);
  });

  it('setCells with "" deletes the cell', () => {
    const ws = applyWsOps(base(), [{ op: "setCells", tableId: "t1", rowId: "r1", cells: { value: "" } }]);
    expect(findTable(ws, "t1").rows[0].cells).toEqual({ name: "IRA" });
  });

  it("removeRows on an unknown row throws and changes nothing", () => {
    const ws = base();
    const copy = structuredClone(ws);
    expect(() =>
      applyWsOps(ws, [
        { op: "removeRows", tableId: "t1", rowIds: ["r1"] },
        { op: "removeRows", tableId: "t1", rowIds: ["ghost"] },
      ]),
    ).toThrow(WorksheetOpError);
    expect(ws).toEqual(copy);
  });

  it("markComposed adds each file id once", () => {
    const ws = applyWsOps(emptyWorksheet(), [
      { op: "markComposed", fileIds: ["f1", "f2", "f1"] },
      { op: "markComposed", fileIds: ["f2"] },
    ]);
    expect(ws.composedFileIds).toEqual(["f1", "f2"]);
  });

  it("any op on a derived worksheet returns one without derived", () => {
    const out = applyWsOps({ ...emptyWorksheet(), derived: true }, [{ op: "markComposed", fileIds: [] }]);
    expect(out.derived).toBeUndefined();
  });

  it("updateTable sets the title and removes the note with null; setRowRef and removeTable work", () => {
    let ws = applyWsOps(base(), [{ op: "updateTable", tableId: "t1", title: "Acc", note: "hi" }]);
    expect(findTable(ws, "t1")).toMatchObject({ title: "Acc", note: "hi" });
    ws = applyWsOps(ws, [
      { op: "updateTable", tableId: "t1", note: null },
      { op: "setRowRef", tableId: "t1", rowId: "r1", ref: { rowId: "s1" } },
    ]);
    expect(findTable(ws, "t1").note).toBeUndefined();
    expect(findTable(ws, "t1").rows[0].ref).toEqual({ rowId: "s1" });
    ws = applyWsOps(ws, [{ op: "removeTable", tableId: "t1" }]);
    expect(ws.tables).toEqual([]);
    expect(() => findTable(ws, "t1")).toThrow(WorksheetOpError);
  });

  it("columnByHeader trims and ignores case", () => {
    expect(columnByHeader(findTable(base(), "t1"), "  VALUE ")?.id).toBe("value");
    expect(columnByHeader(findTable(base(), "t1"), "zzz")).toBeUndefined();
  });
});
