// src/lib/fact-finder/__tests__/ops.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { FactFinderOpError, applyOps, diffSnapshots, parseOps, type FFOp, type OpContext } from "../ops";
import { emptyFactFinderState, sameJson } from "../state";
import type { FactFinderState, FFCell, FFCellValue, FFRow } from "../types";

let n = 0;
const ctx: OpContext = { by: "advisor", now: "2026-10-12T12:00:00.000Z", newId: () => `new-${++n}` };
beforeEach(() => {
  n = 0;
});

const doc = (value: FFCellValue, confidence = 0.9): FFCell => ({
  value,
  confidence,
  by: "document",
  source: { fileId: "f1" },
});
const row = (id: string, cells: Record<string, FFCell>, extra: Partial<FFRow> = {}): FFRow => ({
  id,
  cells,
  sourceFileIds: ["f1"],
  ...extra,
});
function withRows(rows: Record<string, FFRow[]>): FactFinderState {
  const s = emptyFactFinderState();
  return { ...s, sections: { ...s.sections, ...rows } };
}
const ira = () =>
  row("r1", { accountName: doc("Fidelity IRA"), currentValue: doc(640000), accountType: doc("Traditional IRA") });

describe("setCell / clearCell", () => {
  it("normalizes the value and pins the cell", () => {
    const s = applyOps(withRows({ retirement: [ira()] }), [
      { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "currentValue", value: "$650,000" },
    ], ctx);
    expect(s.sections.retirement[0].cells.currentValue).toEqual({ value: 650000, by: "advisor", pinned: true });
  });

  it("refuses a value that isn't one of the column's options", () => {
    expect(() =>
      applyOps(withRows({ retirement: [ira()] }), [
        { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "accountType", value: "Pension" },
      ], ctx),
    ).toThrow(/isn't one of the options for Account type/);
  });

  it("refuses unknown sections, columns and rows", () => {
    const s = withRows({ retirement: [ira()] });
    const bad: FFOp[] = [
      { op: "setCell", sectionId: "nope", rowId: "r1", columnId: "x", value: 1 },
      { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "nope", value: 1 },
      { op: "setCell", sectionId: "retirement", rowId: "gone", columnId: "currentValue", value: 1 },
    ];
    for (const op of bad) expect(() => applyOps(s, [op], ctx)).toThrow(FactFinderOpError);
  });

  it("clears a cell by pinning it empty, and treats a blank set the same way", () => {
    const s = applyOps(withRows({ retirement: [ira()] }), [
      { op: "clearCell", sectionId: "retirement", rowId: "r1", columnId: "currentValue" },
      { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "accountName", value: "" },
    ], ctx);
    expect(s.sections.retirement[0].cells.currentValue).toEqual({ value: null, by: "advisor", pinned: true });
    expect(s.sections.retirement[0].cells.accountName).toEqual({ value: null, by: "advisor", pinned: true });
  });

  it("edits fixed rows", () => {
    const s = applyOps(emptyFactFinderState(), [
      { op: "setCell", sectionId: "people", rowId: "people:Client", columnId: "dateOfBirth", value: "4/12/1968" },
    ], ctx);
    expect(s.sections.people[0].cells.dateOfBirth.value).toBe("1968-04-12");
  });
});

describe("rows", () => {
  it("adds a row with a minted id and validated cells", () => {
    const s = applyOps(emptyFactFinderState(), [
      { op: "addRow", sectionId: "cash", cells: { accountName: "Savings", currentValue: "12,000" } },
    ], ctx);
    expect(s.sections.cash).toEqual([
      {
        id: "new-1",
        cells: {
          accountName: { value: "Savings", by: "advisor", pinned: true },
          currentValue: { value: 12000, by: "advisor", pinned: true },
        },
        sourceFileIds: [],
      },
    ]);
  });

  it("refuses to add to a fixed-row section, or to reuse an id", () => {
    expect(() => applyOps(emptyFactFinderState(), [{ op: "addRow", sectionId: "people" }], ctx)).toThrow(/fixed rows/);
    expect(() =>
      applyOps(withRows({ retirement: [ira()] }), [{ op: "addRow", sectionId: "cash", rowId: "r1" }], ctx),
    ).toThrow(/already in use/);
  });

  it("moves a removed row to the tray and restores it", () => {
    const removed = applyOps(withRows({ retirement: [ira()] }), [
      { op: "removeRow", sectionId: "retirement", rowId: "r1", reason: "Closed in 2024" },
    ], ctx);
    expect(removed.sections.retirement).toEqual([]);
    expect(removed.removed).toEqual([
      { sectionId: "retirement", row: ira(), reason: "Closed in 2024", by: "advisor", at: ctx.now },
    ]);
    const restored = applyOps(removed, [{ op: "restoreRow", rowId: "r1" }], ctx);
    expect(restored.sections.retirement).toEqual([ira()]);
    expect(restored.removed).toEqual([]);
  });

  it("won't remove a fixed row", () => {
    expect(() =>
      applyOps(emptyFactFinderState(), [{ op: "removeRow", sectionId: "people", rowId: "people:Client" }], ctx),
    ).toThrow(/can't be removed/);
  });

  it("merges two rows: the kept row's values win, blanks fill from the other, a pinned blank stays blank", () => {
    const keep = row("k", {
      accountName: doc("Schwab IRA"),
      currentValue: { value: null, by: "advisor", pinned: true },
    });
    const drop = row(
      "d",
      { accountName: doc("IRA x2201"), currentValue: doc(5), last4: doc("2201"), custodian: doc("Schwab") },
      { sourceFileIds: ["f2"], holdings: [{ id: "h1", ticker: "VTI", name: null, shares: 1, price: 1, marketValue: 1, costBasis: null, by: "document" }] },
    );
    const s = applyOps(withRows({ retirement: [keep, drop] }), [
      { op: "mergeRows", sectionId: "retirement", keepRowId: "k", dropRowId: "d" },
    ], ctx);
    const merged = s.sections.retirement;
    expect(merged.map((r) => r.id)).toEqual(["k"]);
    expect(merged[0].cells.accountName.value).toBe("Schwab IRA");
    expect(merged[0].cells.currentValue.value).toBeNull();
    expect(merged[0].cells.last4.value).toBe("2201");
    expect(merged[0].sourceFileIds).toEqual(["f1", "f2"]);
    expect(merged[0].holdings?.map((h) => h.id)).toEqual(["h1"]);
    expect(s.removed[0]).toMatchObject({ sectionId: "retirement", reason: "Merged into Schwab IRA", mergedInto: "k" });
  });
});

describe("links", () => {
  it("confirms a link with its candidate's score and releases another row's claim on the same record", () => {
    const taxable = row("t1", { accountName: doc("Brokerage") }, {
      link: { kind: "existing", recordId: "acct-1", score: 0.95, confirmed: true, by: "auto" },
    });
    const cash = row("c1", { accountName: doc("Brokerage cash") }, {
      linkCandidates: [{ recordId: "acct-1", label: "Schwab Brokerage", score: 0.62 }],
    });
    const s = applyOps(withRows({ taxable: [taxable], cash: [cash] }), [
      { op: "setLink", sectionId: "cash", rowId: "c1", link: { kind: "existing", recordId: "acct-1" } },
    ], ctx);
    expect(s.sections.cash[0].link).toEqual({ kind: "existing", recordId: "acct-1", score: 0.62, confirmed: true, by: "advisor" });
    expect(s.sections.taxable[0].link).toEqual({ kind: "existing", recordId: "acct-1", score: 0.95, confirmed: false, by: "auto" });
  });

  it("sets New, and refuses a section that doesn't link", () => {
    const s = applyOps(withRows({ retirement: [ira()] }), [
      { op: "setLink", sectionId: "retirement", rowId: "r1", link: { kind: "new" } },
    ], ctx);
    expect(s.sections.retirement[0].link).toEqual({ kind: "new", by: "advisor" });
    const items = withRows({ living_items: [row("i1", { item: doc("Groceries") })] });
    expect(() =>
      applyOps(items, [{ op: "setLink", sectionId: "living_items", rowId: "i1", link: { kind: "new" } }], ctx),
    ).toThrow(/don't link/);
  });
});

describe("holdings", () => {
  const withHolding = () =>
    withRows({
      taxable: [
        row("t1", { accountName: doc("Brokerage"), last4: doc("7731") }, {
          holdings: [{ id: "h1", ticker: "VTI", name: "Vanguard", shares: 10, price: 250, marketValue: 2500, costBasis: null, by: "document" }],
        }),
      ],
    });

  it("edits a holding field and pins the holding", () => {
    const s = applyOps(withHolding(), [
      { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "marketValue", value: "$2,600" },
    ], ctx);
    expect(s.sections.taxable[0].holdings?.[0]).toMatchObject({ marketValue: 2600, by: "advisor", pinned: true });
    expect(() =>
      applyOps(withHolding(), [
        { op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1", field: "shares", value: "lots" },
      ], ctx),
    ).toThrow(/isn't a valid shares/);
  });

  it("removes a holding and remembers it so later readings don't bring it back", () => {
    const s = applyOps(withHolding(), [{ op: "removeHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1" }], ctx);
    expect(s.sections.taxable[0].holdings).toEqual([]);
    expect(s.sections.taxable[0].droppedHoldingKeys).toEqual(["t:VTI"]);
  });

  it("assigns an unassigned holding to an account", () => {
    const start: FactFinderState = {
      ...withHolding(),
      unassignedHoldings: [
        { id: "u1", ticker: "AAPL", name: "Apple", shares: 5, price: 200, marketValue: 1000, costBasis: null, by: "document", accountHint: "x9999" },
      ],
    };
    const s = applyOps(start, [
      { op: "assignHolding", holdingId: "u1", from: "unassigned", to: { sectionId: "taxable", rowId: "t1" } },
    ], ctx);
    expect(s.unassignedHoldings).toEqual([]);
    const moved = s.sections.taxable[0].holdings?.[1];
    expect(moved).toMatchObject({ id: "u1", ticker: "AAPL", by: "advisor", pinned: true });
    expect(moved && "accountHint" in moved).toBe(false);
  });
});

describe("applyOps", () => {
  it("is all-or-nothing and leaves version alone", () => {
    const start = withRows({ retirement: [ira()] });
    const frozen = JSON.stringify(start);
    expect(() =>
      applyOps(start, [
        { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "currentValue", value: 1 },
        { op: "setCell", sectionId: "retirement", rowId: "missing", columnId: "currentValue", value: 2 },
      ], ctx),
    ).toThrow(FactFinderOpError);
    expect(JSON.stringify(start)).toBe(frozen);
    const ok = applyOps(start, [{ op: "clearCell", sectionId: "retirement", rowId: "r1", columnId: "last4" }], ctx);
    expect(ok.version).toBe(start.version);
  });

  it("keeps untouched rows by reference", () => {
    const other = row("r2", { accountName: doc("Roth") });
    const start = withRows({ retirement: [ira(), other] });
    const s = applyOps(start, [{ op: "clearCell", sectionId: "retirement", rowId: "r1", columnId: "last4" }], ctx);
    expect(s.sections.retirement[1]).toBe(start.sections.retirement[1]);
    expect(s.sections.cash).toBe(start.sections.cash);
  });
});

describe("undo snapshots", () => {
  it("snapshots changed rows and restores them", () => {
    const start = withRows({ retirement: [ira(), row("r2", { accountName: doc("Roth") })] });
    const after = applyOps(start, [
      { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "currentValue", value: 1 },
      { op: "removeRow", sectionId: "retirement", rowId: "r2" },
      { op: "addRow", sectionId: "cash", rowId: "c-new", cells: { accountName: "New cash" } },
    ], ctx);
    const snapshots = diffSnapshots(start, after);
    expect(snapshots.map((s) => (s.kind === "row" ? s.rowId : "unassigned")).sort()).toEqual(["c-new", "r1", "r2"]);
    const undone = applyOps(after, [{ op: "restoreSnapshots", snapshots }], ctx);
    expect(sameJson(undone.sections, start.sections)).toBe(true);
    expect(undone.removed).toEqual([]);
  });

  it("refuses when a row has changed since", () => {
    const start = withRows({ retirement: [ira()] });
    const after = applyOps(start, [
      { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "currentValue", value: 1 },
    ], ctx);
    const snapshots = diffSnapshots(start, after);
    const edited = applyOps(after, [
      { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "currentValue", value: 2 },
    ], ctx);
    expect(() => applyOps(edited, [{ op: "restoreSnapshots", snapshots }], ctx)).toThrow(/changed since/);
  });
});

describe("parseOps", () => {
  it("accepts client ops and rejects undo or unknown ops", () => {
    expect(parseOps([{ op: "clearCell", sectionId: "cash", rowId: "r", columnId: "last4" }])).toHaveLength(1);
    expect(() => parseOps([{ op: "restoreSnapshots", snapshots: [] }])).toThrow(FactFinderOpError);
    expect(() => parseOps([{ op: "dropTable" }])).toThrow(FactFinderOpError);
    expect(() => parseOps([])).toThrow(FactFinderOpError);
  });
});
