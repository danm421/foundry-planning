import { describe, expect, it } from "vitest";
import { DEFAULT_TABLES, fillRows, stagingRowsNotShown, worksheetFromStaging } from "../from-staging";
import { emptyFactFinderState } from "../../state";
import type { FFRow } from "../../types";

function row(id: string, cells: Record<string, string | number>, extra: Partial<FFRow> = {}): FFRow {
  return {
    id,
    sourceFileIds: ["f1"],
    cells: Object.fromEntries(Object.entries(cells).map(([k, value]) => [k, { value, by: "document" as const, confidence: 0.99 }])),
    ...extra,
  };
}

describe("fillRows", () => {
  it('makes one row per staging row with values, ids "t-accounts/<rowId>"', () => {
    const s = emptyFactFinderState();
    s.sections.cash = [row("c1", { accountName: "Checking" }), row("c2", {})];
    s.sections.taxable = [row("b1", { accountName: "Brokerage" })];
    const rows = fillRows(s, "t-accounts", DEFAULT_TABLES[0]);
    expect(rows.map((r) => r.id)).toEqual(["t-accounts/c1", "t-accounts/b1"]);
    expect(rows[0]).toEqual({ id: "t-accounts/c1", cells: {}, ref: { rowId: "c1" }, source: { fileId: "f1" } });
  });

  it("skips staging rows the table already shows", () => {
    const s = emptyFactFinderState();
    s.sections.cash = [row("c1", { accountName: "Checking" })];
    const first = fillRows(s, "t-accounts", DEFAULT_TABLES[0]);
    const table = { id: "t-accounts", title: "Accounts", columns: [], rows: first };
    expect(fillRows(s, "t-accounts", DEFAULT_TABLES[0], table)).toEqual([]);
    s.sections.cash.push(row("c2", { accountName: "Savings" }));
    expect(fillRows(s, "t-accounts", DEFAULT_TABLES[0], table).map((r) => r.ref?.rowId)).toEqual(["c2"]);
  });

  it("with holdings makes one row per holding, ref { rowId, holdingId }", () => {
    const s = emptyFactFinderState();
    const h = { ticker: "VTI", name: null, shares: 1, price: null, marketValue: null, costBasis: null, by: "document" as const };
    s.sections.taxable = [row("b1", { accountName: "B" }, { holdings: [{ id: "h1", ...h }, { id: "h2", ...h }] })];
    const rows = fillRows(s, "t-holdings", DEFAULT_TABLES[1]);
    expect(rows.map((r) => [r.id, r.ref])).toEqual([
      ["t-holdings/b1/h1", { rowId: "b1", holdingId: "h1" }],
      ["t-holdings/b1/h2", { rowId: "b1", holdingId: "h2" }],
    ]);
  });

  it("cites the staging row's file and page", () => {
    const s = emptyFactFinderState();
    s.sections.cash = [
      row("c1", {}, { sourceFileIds: ["f9"], cells: { accountName: { value: "X", by: "document", source: { fileId: "f2", page: 3 } } } }),
    ];
    expect(fillRows(s, "t-accounts", DEFAULT_TABLES[0])[0].source).toEqual({ fileId: "f2", page: 3 });
  });
});

describe("worksheetFromStaging", () => {
  it("drops tables with no rows and marks derived", () => {
    const s = emptyFactFinderState();
    expect(worksheetFromStaging(s)).toEqual({ tables: [], composedFileIds: [], derived: true });
    s.sections.cash = [row("c1", { accountName: "Checking" })];
    const ws = worksheetFromStaging(s);
    expect(ws.derived).toBe(true);
    expect(ws.tables.map((t) => t.id)).toEqual(["t-accounts"]);
    expect(ws.tables[0].columns[0]).toMatchObject({ id: "c-cell-accountName", header: "Account", bind: { kind: "cell", columnId: "accountName" } });
  });

  it("the per-section default table has only columns with a value", () => {
    const s = emptyFactFinderState();
    s.sections.living_items = [row("l1", { amount: 5000 })];
    const t = worksheetFromStaging(s).tables.find((x) => x.id === "t-living_items");
    expect(t?.columns.map((c) => c.id)).toEqual(["c-cell-amount"]);
  });
});

describe("stagingRowsNotShown", () => {
  it("ignores removed rows and rows a holding row references", () => {
    const s = emptyFactFinderState();
    s.sections.taxable = [row("b1", { accountName: "B" }), row("b2", { accountName: "C" })];
    s.sections.cash = [row("c1", { accountName: "Chk" })];
    s.removed = [{ sectionId: "cash", row: row("c9", { accountName: "Gone" }), reason: "x", by: "advisor", at: "t" }];
    s.worksheet = { tables: [{ id: "t", title: "T", columns: [], rows: [{ id: "r", cells: {}, ref: { rowId: "b1", holdingId: "h1" } }] }], composedFileIds: [] };
    expect(stagingRowsNotShown(s)).toEqual([
      { sectionId: "cash", rowId: "c1" },
      { sectionId: "taxable", rowId: "b2" },
    ]);
  });

  it("flags holdings no worksheet row shows: a shown account's new ones, and an unshown account's", () => {
    const s = emptyFactFinderState();
    const h = { ticker: "VTI", name: null, shares: 1, price: null, marketValue: null, costBasis: null, by: "document" as const };
    s.sections.taxable = [row("b1", { accountName: "Joint" }, { holdings: [{ id: "h1", ...h }, { id: "h2", ...h }] })];
    s.sections.retirement = [row("r9", { accountName: "Roth" }, { holdings: [{ id: "h3", ...h }] })];
    s.worksheet = {
      tables: [
        { id: "t-accounts", title: "Accounts", columns: [], rows: [{ id: "a", cells: {}, ref: { rowId: "b1" } }] },
        { id: "t-holdings", title: "Holdings", columns: [], rows: [{ id: "x", cells: {}, ref: { rowId: "b1", holdingId: "h1" } }] },
      ],
      composedFileIds: [],
    };
    expect(stagingRowsNotShown(s)).toEqual([
      { sectionId: "taxable", rowId: "b1", shown: true, holdingIds: ["h2"] },
      { sectionId: "retirement", rowId: "r9", holdingIds: ["h3"] },
    ]);
  });
});
