import { describe, expect, it } from "vitest";
import { emptyFactFinderState } from "../../state";
import type { FactFinderState, FFFileReading, FFRow } from "../../types";
import { composeRequest } from "../compose";
import { runWorksheetTool, type WsToolContext } from "../tools";
import { applyTurnOps } from "../turn-ops";

const files = [
  { id: "f1", name: "schwab.pdf" },
  { id: "f2", name: "notes.docx" },
];
const done = (reader: FFFileReading["reader"]): FFFileReading => ({ status: "done", reader, startedAt: "t" });
const ira: FFRow = {
  id: "r1",
  sourceFileIds: ["f1"],
  cells: { accountName: { value: "Joint IRA", by: "document", confidence: 0.99 }, currentValue: { value: 100, by: "document", confidence: 0.99 } },
};

function stateWith(readings: FactFinderState["readings"], extra: Partial<FactFinderState> = {}): FactFinderState {
  return { ...emptyFactFinderState(), readings, ...extra };
}

describe("composeRequest", () => {
  it("nothing new → no files, no message", () => {
    expect(composeRequest(stateWith({}), files)).toEqual({ fileIds: [], message: null });
    const s = stateWith({ f2: done("freeform") }, { worksheet: { tables: [], composedFileIds: ["f2"] } });
    expect(composeRequest(s, files)).toEqual({ fileIds: [], message: null });
  });

  it("a new free-form file asks for read_document", () => {
    const r = composeRequest(stateWith({ f2: done("freeform") }), files);
    expect(r.fileIds).toEqual(["f2"]);
    expect(r.message).toContain("read it with read_document");
    expect(r.message).toContain("notes.docx");
  });

  it("a new statement whose rows the derived tables show → its file id, no message", () => {
    const s = stateWith({ f1: done("statement") });
    s.sections.retirement = [ira];
    s.worksheet = { tables: [{ id: "t", title: "T", columns: [], rows: [{ id: "w", cells: {}, ref: { rowId: "r1" } }] }], composedFileIds: [] };
    expect(composeRequest(s, files)).toEqual({ fileIds: ["f1"], message: null });
  });

  it("a new statement with unshown rows lists them", () => {
    const s = stateWith({ f1: done("statement") });
    s.sections.retirement = [ira];
    const r = composeRequest(s, files);
    expect(r.fileIds).toEqual(["f1"]);
    expect(r.message).toContain("schwab.pdf");
    expect(r.message).toContain("- r1 [retirement] ");
    expect(r.message).toContain("Joint IRA");
  });

  it("ignores files still reading or failed", () => {
    const s = stateWith({ f1: { status: "reading", startedAt: "t" }, f2: { status: "failed", startedAt: "t" } });
    expect(composeRequest(s, files)).toEqual({ fileIds: [], message: null });
  });

  it("fences file names and row lines, redacting SSNs", () => {
    const r = composeRequest(stateWith({ f2: done("freeform") }), [{ id: "f2", name: "ssn 123-45-6789.pdf" }]);
    expect(r.message).toContain("<<<UNTRUSTED DATA");
    expect(r.message).not.toContain("123-45-6789");
  });
});

describe("a later statement's holdings (the worksheet already shows the first statement)", () => {
  const holding = (id: string, ticker: string) => ({ id, ticker, name: null, shares: 1, price: null, marketValue: null, costBasis: null, by: "document" as const });
  const twoFiles = [...files, { id: "f3", name: "roth.pdf" }];
  /** Joint (f1) shown with VTI; then roth.pdf (f3) adds a Roth IRA with 2 holdings, and a newer Joint statement adds AAPL. */
  function later(): FactFinderState {
    const s = stateWith({ f1: done("statement"), f3: done("statement") }, { worksheet: { tables: [], composedFileIds: ["f1"] } });
    s.sections.taxable = [{ ...ira, id: "b1", sourceFileIds: ["f1", "f3"], holdings: [holding("h1", "VTI"), holding("h4", "AAPL")] }];
    s.sections.retirement = [{ ...ira, id: "r9", sourceFileIds: ["f3"], cells: { accountName: { value: "Roth IRA x9088", by: "document", confidence: 0.99 } }, holdings: [holding("h2", "VTSAX"), holding("h3", "SWVXX")] }];
    s.worksheet.tables = [
      { id: "t-accounts", title: "Accounts", columns: [], rows: [{ id: "t-accounts/b1", cells: {}, ref: { rowId: "b1" } }] },
      { id: "t-holdings", title: "Holdings", columns: [], rows: [{ id: "t-holdings/b1/h1", cells: {}, ref: { rowId: "b1", holdingId: "h1" } }] },
    ];
    return s;
  }

  it("are listed for the compose — a new account's, and new ones under an account already shown", () => {
    const r = composeRequest(later(), twoFiles);
    expect(r.fileIds).toEqual(["f3"]);
    expect(r.message).toContain("holdings: true");
    expect(r.message).toContain("- r9 [retirement] Roth IRA x9088 (and its 2 holdings)");
    expect(r.message).toContain("- b1 [taxable] Joint IRA (its row is shown; 1 of its holdings isn't)");
  });

  it("fill_from_staging with holdings: true fills them into the holdings table; a second call adds nothing, and nothing is left to list", async () => {
    let n = 0;
    const ctx: WsToolContext = { files: twoFiles, documentPages: async () => [], lookAtPages: async () => "", planText: async () => "", newId: () => `id-${++n}` };
    const apply = (s: FactFinderState, ops: Parameters<typeof applyTurnOps>[1]) => applyTurnOps(s, ops, { by: "chat", now: "t", newId: ctx.newId });
    let s = later();
    s = apply(s, (await runWorksheetTool("fill_from_staging", { table: "t-accounts", sections: ["taxable", "retirement"] }, s, ctx)).ops);
    const holdingsArgs = { table: "t-holdings", sections: ["taxable", "retirement"], holdings: true };
    const filled = await runWorksheetTool("fill_from_staging", holdingsArgs, s, ctx);
    expect(filled.summary).toBe("Added 3 rows to Holdings");
    s = apply(s, filled.ops);
    expect(s.worksheet.tables[1].rows.map((r) => r.id)).toEqual(["t-holdings/b1/h1", "t-holdings/b1/h4", "t-holdings/r9/h2", "t-holdings/r9/h3"]);
    expect((await runWorksheetTool("fill_from_staging", holdingsArgs, s, ctx)).ops).toEqual([]);
    expect(composeRequest(s, twoFiles)).toEqual({ fileIds: ["f3"], message: null });
  });
});
