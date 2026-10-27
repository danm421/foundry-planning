import { describe, expect, it } from "vitest";
import { cellText, rowInPlan, tableMarkdown } from "../render";
import { emptyFactFinderState } from "../../state";
import type { FactFinderState, FFRow } from "../../types";
import type { WsColumn, WsRow, WsTable } from "../types";

function stateWith(row: FFRow, sectionId = "retirement"): FactFinderState {
  const s = emptyFactFinderState();
  s.sections[sectionId] = [row];
  return s;
}

const ira: FFRow = {
  id: "r1",
  sourceFileIds: ["f1"],
  cells: {
    accountName: { value: "Joint IRA", by: "document", confidence: 0.99 },
    currentValue: { value: 431050, by: "document", confidence: 0.99 },
  },
  holdings: [{ id: "h1", ticker: "VTI", name: "Total Market", shares: 10.5, price: 250.1234, marketValue: 2626.29, costBasis: null, by: "document" }],
};
const valueCol: WsColumn = { id: "v", header: "Value", bind: { kind: "cell", columnId: "currentValue" } };

describe("cellText", () => {
  it('formats a bound money cell from staging with its cents, "$431,050.00"', () => {
    expect(cellText(stateWith(ira), { id: "x", cells: {}, ref: { rowId: "r1" } }, valueCol)).toEqual({ text: "$431,050.00", bound: true, check: false });
  });

  it("bound money keeps its trailing zero cents, as typed money does: $222,942.50, price $285.40", () => {
    const s = stateWith({ ...ira, cells: { currentValue: { value: 222942.5, by: "document" } }, holdings: [{ ...ira.holdings![0], price: 285.4, marketValue: 117014 }] });
    const row: WsRow = { id: "x", cells: {}, ref: { rowId: "r1", holdingId: "h1" } };
    expect(cellText(s, row, valueCol).text).toBe("$222,942.50");
    expect(cellText(s, row, { id: "p", header: "Price", bind: { kind: "holding", field: "price" } }).text).toBe("$285.40");
    expect(cellText(s, row, { id: "m", header: "Market value", bind: { kind: "holding", field: "marketValue" } }).text).toBe("$117,014.00");
  });

  it("formats money cents, holdings and a missing cell", () => {
    const s = stateWith({ ...ira, cells: { ...ira.cells, currentValue: { value: 12500.25, by: "advisor" } } });
    const row: WsRow = { id: "x", cells: {}, ref: { rowId: "r1", holdingId: "h1" } };
    expect(cellText(s, row, valueCol).text).toBe("$12,500.25");
    expect(cellText(s, row, { id: "p", header: "Price", bind: { kind: "holding", field: "price" } }).text).toBe("$250.1234");
    expect(cellText(s, row, { id: "p", header: "Shares", bind: { kind: "holding", field: "shares" } }).text).toBe("10.5");
    expect(cellText(s, row, { id: "p", header: "Basis", bind: { kind: "holding", field: "costBasis" } }).text).toBe("");
    expect(cellText(s, row, { id: "p", header: "Last 4", bind: { kind: "cell", columnId: "last4" } })).toEqual({ text: "", bound: true, check: false });
  });

  it("returns the row's text for an unbound column", () => {
    const row: WsRow = { id: "x", cells: { n: "hello" }, ref: { rowId: "r1" } };
    expect(cellText(stateWith(ira), row, { id: "n", header: "Note" })).toEqual({ text: "hello", bound: false, check: false });
  });

  it("returns the row's text for a bound column on a row with no ref", () => {
    const row: WsRow = { id: "x", cells: { v: "$5" } };
    expect(cellText(stateWith(ira), row, valueCol)).toEqual({ text: "$5", bound: false, check: false });
  });

  it("flags a staging value that needs checking", () => {
    const s = stateWith({ ...ira, cells: { currentValue: { value: 100, by: "document", confidence: 0.2 } } });
    expect(cellText(s, { id: "x", cells: {}, ref: { rowId: "r1" } }, valueCol).check).toBe(true);
  });

  it('a section binding shows the section label "Retirement Accounts"', () => {
    const col: WsColumn = { id: "t", header: "Type", bind: { kind: "section" } };
    expect(cellText(stateWith(ira), { id: "x", cells: {}, ref: { rowId: "r1" } }, col).text).toBe("Retirement Accounts");
  });
});

describe("tableMarkdown", () => {
  it("escapes pipes and renders blanks as empty cells", () => {
    const table: WsTable = {
      id: "t",
      title: "T",
      columns: [
        { id: "a", header: "Name" },
        { id: "b", header: "Note" },
      ],
      rows: [
        { id: "1", cells: { a: "A|B", b: "line1\nline2" } },
        { id: "2", cells: { a: "C" } },
      ],
    };
    expect(tableMarkdown(emptyFactFinderState(), table)).toBe(
      ["| Name | Note |", "| --- | --- |", "| A\\|B | line1 line2 |", "| C |  |"].join("\n"),
    );
  });
});

describe("rowInPlan", () => {
  it("is true for a holding row whose account row was applied", () => {
    const s = { ...stateWith(ira), applied: [{ lineId: "r1/account", rowId: "r1", target: "account" as const, recordId: "a1", label: "IRA", at: "2026-10-26T00:00:00Z" }] };
    expect(rowInPlan(s, { id: "x", cells: {}, ref: { rowId: "r1", holdingId: "h1" } })).toBe(true);
    expect(rowInPlan(s, { id: "y", cells: {}, ref: { rowId: "r2" } })).toBe(false);
    expect(rowInPlan(s, { id: "z", cells: {} })).toBe(false);
  });
});
