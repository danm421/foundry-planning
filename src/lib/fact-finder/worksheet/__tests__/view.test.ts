import { describe, expect, it } from "vitest";
import { emptyFactFinderState } from "../../state";
import type { FactFinderState, FFRow } from "../../types";
import type { WsRow, WsTable } from "../types";
import { VIEW_MAX_ROWS, tableView, worksheetView } from "../view";

const ira: FFRow = {
  id: "r1",
  sourceFileIds: ["f1"],
  cells: {
    accountName: { value: "Joint IRA", by: "document", confidence: 0.99 },
    currentValue: { value: 431050, by: "document", confidence: 0.99 },
  },
  holdings: [{ id: "h1", ticker: "VTI", name: "Total Market", shares: 10, price: 250, marketValue: 2500, costBasis: null, by: "document" }],
};
const files = [{ id: "f1", name: "schwab.pdf" }];

function stateWith(tables: WsTable[], extra: Partial<FactFinderState> = {}): FactFinderState {
  const s = emptyFactFinderState();
  s.sections.retirement = [ira];
  return { ...s, worksheet: { tables, composedFileIds: [] }, ...extra };
}

const table = (rows: WsRow[]): WsTable => ({
  id: "t1",
  title: "Accounts",
  columns: [
    { id: "n", header: "Account", bind: { kind: "cell", columnId: "accountName" } },
    { id: "v", header: "Value", bind: { kind: "cell", columnId: "currentValue" } },
    { id: "note", header: "Note" },
  ],
  rows,
});

describe("worksheetView", () => {
  it("shows bound values, refs, in-plan marks and sources", () => {
    const s = stateWith([table([{ id: "w1", cells: { note: "hi" }, ref: { rowId: "r1", holdingId: "h1" }, source: { fileId: "f1", page: 3 } }])], {
      applied: [{ lineId: "l", rowId: "r1", target: "account", recordId: "a1", label: "x", at: "t" }],
    });
    const out = worksheetView(s, files);
    expect(out).toContain('## t1 "Accounts"');
    expect(out).toContain("Account [cell:accountName]");
    expect(out).toContain("Note");
    expect(out).toContain("- w1 [ref r1/h1] [in plan] | Account: Joint IRA | Value: $431,050 | Note: hi");
    expect(out).toContain('(source: "schwab.pdf" p.3)');
  });

  it("a long table is cut at 120 rows with a read_table hint", () => {
    const rows = Array.from({ length: 130 }, (_, i): WsRow => ({ id: `w${i}`, cells: { note: "x" } }));
    const s = stateWith([table(rows)]);
    const out = worksheetView(s, files);
    expect(out).toContain("- w119 ");
    expect(out).not.toContain("- w120 ");
    expect(out).toContain("… 10 more rows — read_table shows them");
    expect(VIEW_MAX_ROWS).toBe(120);
    const rest = tableView(s, "t1", 120);
    expect(rest).toContain("- w120 ");
    expect(rest).not.toContain("more rows");
  });

  it("lists staging rows not on the worksheet", () => {
    const out = worksheetView(stateWith([]), files);
    expect(out).toContain("## Staging rows not on the worksheet");
    expect(out).toMatch(/- r1 \[retirement\] Joint IRA/);
  });
});
