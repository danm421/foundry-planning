import { describe, expect, it, vi } from "vitest";
import { FENCE_CLOSE, FENCE_OPEN } from "../../chat/fence";
import { REREAD_MAX_CHARS } from "../../chat/tools";
import type { OpContext } from "../../ops";
import { emptyFactFinderState } from "../../state";
import type { FactFinderState, FFCell, FFCellValue, FFRow } from "../../types";
import { cellText } from "../render";
import { MAX_LOOK_PAGES, WS_TOOL_DEFS, refusedLine, runWorksheetTool, type WsToolContext, type WsToolOutcome } from "../tools";
import { applyTurnOps } from "../turn-ops";
import type { WsTable } from "../types";

const AT = "2026-10-26T12:00:00.000Z";
const chat: OpContext = { by: "chat", now: AT, newId: () => "unused" };
const doc = (value: FFCellValue): FFCell => ({ value, by: "document", confidence: 0.99, source: { fileId: "f1", page: 2 } });
const ira: FFRow = {
  id: "r1",
  sourceFileIds: ["f1"],
  cells: { accountName: doc("Joint IRA"), currentValue: doc(431050) },
  holdings: [{ id: "h1", ticker: "VTI", name: "Total Market", shares: 10, price: 250, marketValue: 2500, costBasis: null, by: "document" }],
};
const files = [
  { id: "f1", name: "schwab.pdf" },
  { id: "f2", name: "fact-finder.pdf" },
];

const accounts: WsTable = {
  id: "t-accounts",
  title: "Accounts",
  columns: [
    { id: "c-name", header: "Account", bind: { kind: "cell", columnId: "accountName" } },
    { id: "c-type", header: "Type", bind: { kind: "section" } },
    { id: "c-value", header: "Value", bind: { kind: "cell", columnId: "currentValue" } },
    { id: "c-note", header: "Note" },
  ],
  rows: [
    { id: "w1", cells: {}, ref: { rowId: "r1" } },
    { id: "w2", cells: { "c-name": "Old 529", "c-note": "from the fact finder" } },
  ],
};
const holdings: WsTable = {
  id: "t-holdings",
  title: "Holdings",
  columns: [
    { id: "h-acct", header: "Account", bind: { kind: "cell", columnId: "accountName" } },
    { id: "h-ticker", header: "Ticker", bind: { kind: "holding", field: "ticker" } },
    { id: "h-shares", header: "Shares", bind: { kind: "holding", field: "shares" } },
  ],
  rows: [
    { id: "wh1", cells: {}, ref: { rowId: "r1", holdingId: "h1" } },
    { id: "wh2", cells: { "h-ticker": "AAPL", "h-shares": "5" } },
  ],
};

function fixture(): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    sections: { ...s.sections, retirement: [structuredClone(ira)] },
    worksheet: { tables: structuredClone([accounts, holdings]), composedFileIds: [] },
  };
}

function context(overrides: Partial<WsToolContext> = {}): WsToolContext {
  let n = 0;
  return {
    files,
    documentPages: vi.fn(async () => []),
    lookAtPages: vi.fn(async () => ""),
    planText: vi.fn(async () => ""),
    newId: () => `id-${++n}`,
    ...overrides,
  };
}

const apply = (state: FactFinderState, outcome: WsToolOutcome) => applyTurnOps(state, outcome.ops, chat);
const fenced = (text: string) => text.startsWith(`${FENCE_OPEN}\n`) && text.endsWith(`\n${FENCE_CLOSE}`);

type ParamSchema = { properties: Record<string, unknown>; required: string[] };

describe("WS_TOOL_DEFS", () => {
  it("pins the worksheet tools' arguments, and carries the staging tools", () => {
    const shape = Object.fromEntries(
      WS_TOOL_DEFS.map((d) => {
        const p = d.function.parameters as ParamSchema;
        return [d.function.name, { args: Object.keys(p.properties), required: p.required }];
      }),
    );
    expect(shape).toMatchObject({
      create_table: { args: ["title", "columns", "note"], required: ["title", "columns"] },
      update_table: { args: ["table", "title", "note"], required: ["table"] },
      remove_table: { args: ["table"], required: ["table"] },
      set_columns: { args: ["table", "columns"], required: ["table", "columns"] },
      fill_from_staging: { args: ["table", "sections", "holdings"], required: ["table", "sections"] },
      add_rows: { args: ["table", "rows"], required: ["table", "rows"] },
      set_cells: { args: ["table", "row", "cells"], required: ["table", "row", "cells"] },
      remove_rows: { args: ["table", "rows", "reason"], required: ["table", "rows", "reason"] },
      read_table: { args: ["table", "fromRow"], required: ["table"] },
      read_document: { args: ["document", "fromPage", "fromChar", "toPage"], required: ["document"] },
      look_at_pages: { args: ["document", "pages"], required: ["document", "pages"] },
      read_plan: { args: [], required: [] },
      stage_rows: { args: ["table", "rows"], required: ["table", "rows"] },
      propose_plan_update: { args: ["rows", "table"], required: [] },
    });
    const staging = ["read_section", "set_cell", "clear_cell", "add_row", "remove_row", "restore_row", "merge_rows", "set_link", "set_holding", "remove_holding", "move_holding", "add_holding"];
    for (const name of staging) expect(shape).toHaveProperty(name);
    expect(Object.keys(shape)).toHaveLength(14 + staging.length);
    expect(Object.keys(shape)).not.toContain("reread_document");
  });

  it("gives every tool a plain line for when a call is refused", () => {
    for (const d of WS_TOOL_DEFS) expect(refusedLine(d.function.name)).toMatch(/^Couldn't [a-z ]+\.$/);
    for (const d of WS_TOOL_DEFS) expect(refusedLine(d.function.name)).not.toBe("Couldn't do that.");
    expect(refusedLine("no_such_tool")).toBe("Couldn't do that.");
  });
});

describe("runWorksheetTool", () => {
  it("create_table then add_rows cites the document by file id", async () => {
    const ctx = context();
    let state = emptyFactFinderState();
    const created = await runWorksheetTool(
      "create_table",
      { title: "Income", columns: [{ header: "Source" }, { header: "Amount" }], note: "From the pay stub" },
      state,
      ctx,
    );
    expect(created.ops).toEqual([
      {
        layer: "ws",
        op: { op: "createTable", tableId: "id-1", title: "Income", note: "From the pay stub", columns: [{ id: "id-2", header: "Source" }, { id: "id-3", header: "Amount" }] },
      },
    ]);
    expect(created.result).toContain("id-1");
    state = apply(state, created);

    const added = await runWorksheetTool(
      "add_rows",
      { table: "id-1", rows: [{ cells: { source: "Acme salary", Amount: "$120,000" }, document: "Fact-Finder.pdf", page: 3 }] },
      state,
      ctx,
    );
    expect(added.summary).toBe("Added 1 row to Income");
    expect(added.result).toContain("id-4");
    state = apply(state, added);
    const income = state.worksheet.tables.find((t) => t.id === "id-1")!;
    expect(income.rows).toEqual([{ id: "id-4", cells: { "id-2": "Acme salary", "id-3": "$120,000" }, source: { fileId: "f2", page: 3 } }]);
  });

  it("set_cells on a bound cell writes the staging cell, pinned by chat", async () => {
    const state = fixture();
    const out = await runWorksheetTool("set_cells", { table: "t-accounts", row: "w1", cells: { value: "$440,000" } }, state, context());
    expect(out.ops).toEqual([
      { layer: "staging", op: { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "currentValue", value: "$440,000" } },
    ]);
    const next = apply(state, out);
    expect(next.sections.retirement[0].cells.currentValue).toEqual({ value: 440000, by: "chat", pinned: true });
    const table = next.worksheet.tables[0];
    expect(cellText(next, table.rows[0], table.columns[2]).text).toBe("$440,000.00");
    expect(out.result).toContain("$440,000.00");
  });

  it("set_cells on a row with no ref writes the worksheet's own text, bound column or not", async () => {
    const state = fixture();
    const out = await runWorksheetTool("set_cells", { table: "t-holdings", row: "wh2", cells: { Shares: "6", ticker: "" } }, state, context());
    expect(out.ops).toEqual([{ layer: "ws", op: { op: "setCells", tableId: "t-holdings", rowId: "wh2", cells: { "h-shares": "6", "h-ticker": "" } } }]);
    expect(apply(state, out).worksheet.tables[1].rows[1].cells).toEqual({ "h-shares": "6" });
  });

  it("set_cells names a row left with no values in plain words, never by its id", async () => {
    const out = await runWorksheetTool("set_cells", { table: "t-accounts", row: "w2", cells: { Account: "", Note: "" } }, fixture(), context());
    expect(out.summary).toBe("Changed Account, Note on a row in Accounts");
  });

  it("set_cells on a bound holding field sets the staging holding", async () => {
    const state = fixture();
    const out = await runWorksheetTool("set_cells", { table: "t-holdings", row: "wh1", cells: { Shares: "12" } }, state, context());
    expect(out.ops).toEqual([
      { layer: "staging", op: { op: "setHolding", sectionId: "retirement", rowId: "r1", holdingId: "h1", field: "shares", value: "12" } },
    ]);
    expect(apply(state, out).sections.retirement[0].holdings?.[0]).toMatchObject({ shares: 12, by: "chat", pinned: true });
  });

  it("set_cells refuses a section column", async () => {
    await expect(
      runWorksheetTool("set_cells", { table: "t-accounts", row: "w1", cells: { Type: "IRA" } }, fixture(), context()),
    ).rejects.toThrow("That column shows where the row sits — it can't be typed.");
  });

  it("set_cells with a value the staging column rejects returns the column's hint", async () => {
    await expect(
      runWorksheetTool("set_cells", { table: "t-accounts", row: "w1", cells: { Value: "lots" } }, fixture(), context()),
    ).rejects.toThrow('"lots" isn\'t a valid Current value (a dollar amount).');
  });

  it("fill_from_staging twice adds nothing the second time", async () => {
    const ctx = context();
    let state = fixture();
    state.sections.cash = [{ id: "c1", sourceFileIds: ["f1"], cells: { accountName: doc("Joint Checking") } }];
    const args = { table: "t-accounts", sections: ["cash", "retirement"] };

    const first = await runWorksheetTool("fill_from_staging", args, state, ctx);
    expect(first.summary).toBe("Added 1 row to Accounts");
    expect(first.ops).toEqual([
      { layer: "ws", op: { op: "addRows", tableId: "t-accounts", rows: [{ id: "t-accounts/c1", cells: {}, ref: { rowId: "c1" }, source: { fileId: "f1", page: 2 } }] } },
    ]);
    state = apply(state, first);

    const second = await runWorksheetTool("fill_from_staging", args, state, ctx);
    expect(second.ops).toEqual([]);
    expect(second.summary).toBe("Added 0 rows to Accounts");
    const again = await runWorksheetTool("fill_from_staging", { table: "t-holdings", sections: ["retirement"], holdings: true }, state, ctx);
    expect(again.ops).toEqual([]);
  });

  it("remove_rows on a referenced row also moves the staging row to the Removed tray", async () => {
    const state = fixture();
    const out = await runWorksheetTool("remove_rows", { table: "t-accounts", rows: ["w1", "w2"], reason: "Closed last year" }, state, context());
    expect(out.ops).toEqual([
      { layer: "ws", op: { op: "removeRows", tableId: "t-accounts", rowIds: ["w1", "w2"] } },
      { layer: "staging", op: { op: "removeRow", sectionId: "retirement", rowId: "r1", reason: "Closed last year" } },
    ]);
    const next = apply(state, out);
    expect(next.worksheet.tables[0].rows).toEqual([]);
    expect(next.sections.retirement).toEqual([]);
    expect(next.removed).toEqual([expect.objectContaining({ sectionId: "retirement", reason: "Closed last year", by: "chat" })]);

    const sold = await runWorksheetTool("remove_rows", { table: "t-holdings", rows: ["wh1"], reason: "Sold" }, state, context());
    expect(sold.ops).toEqual([
      { layer: "ws", op: { op: "removeRows", tableId: "t-holdings", rowIds: ["wh1"] } },
      { layer: "staging", op: { op: "removeHolding", sectionId: "retirement", rowId: "r1", holdingId: "h1" } },
    ]);
  });

  it("remove_rows on a row showing a fixed staging row (the client's details) removes only the worksheet row", async () => {
    const state = fixture();
    const fixedRow = Object.values(state.sections).flat().find((r) => r.id.includes(":"))!;
    state.worksheet.tables[0].rows.push({ id: "w3", cells: {}, ref: { rowId: fixedRow.id } });
    const out = await runWorksheetTool("remove_rows", { table: "t-accounts", rows: ["w3"], reason: "Not an account" }, state, context());
    expect(out.ops).toEqual([{ layer: "ws", op: { op: "removeRows", tableId: "t-accounts", rowIds: ["w3"] } }]);
  });

  it("read_document fences page text and cuts at REREAD_MAX_CHARS", async () => {
    const pages = ["Page one, SSN 123-45-6789", "z".repeat(REREAD_MAX_CHARS), "page three"];
    const ctx = context({ documentPages: vi.fn(async () => pages) });
    const out = await runWorksheetTool("read_document", { document: "Schwab.pdf" }, fixture(), ctx);
    expect(ctx.documentPages).toHaveBeenCalledWith("f1");
    expect(out.ops).toEqual([]);
    expect(fenced(out.result)).toBe(true);
    expect(out.result).toContain("[page 1]\nPage one");
    expect(out.result).not.toContain("123-45-6789");
    expect(out.result).not.toContain("page three");
    expect(out.result.length).toBeLessThanOrEqual(REREAD_MAX_CHARS + FENCE_OPEN.length + FENCE_CLOSE.length + 200);

    // The cut names the page and the character to go on from, so a page longer than the limit (a Word file) reads to its end.
    const goOn = out.result.match(/fromPage: (\d+), fromChar: (\d+)/);
    expect(goOn?.[1]).toBe("2");
    const rest = await runWorksheetTool("read_document", { document: "schwab.pdf", fromPage: 2, fromChar: Number(goOn?.[2]) }, fixture(), ctx);
    const zs = (text: string) => text.split("z").length - 1;
    expect(zs(out.result) + zs(rest.result)).toBe(REREAD_MAX_CHARS);
    expect(rest.result).toContain("[page 3]\npage three");
    expect(rest.result).not.toContain("[page 1]");
    expect(rest.result).not.toContain("fromChar");
  });

  it("look_at_pages refuses more than 4 pages", async () => {
    const ctx = context();
    await expect(
      runWorksheetTool("look_at_pages", { document: "schwab.pdf", pages: [1, 2, 3, 4, 5] }, fixture(), ctx),
    ).rejects.toThrow("4 pages or fewer");
    expect(ctx.lookAtPages).not.toHaveBeenCalled();
    expect(MAX_LOOK_PAGES).toBe(4);

    const looked = context({ lookAtPages: vi.fn(async () => "Market value 431,050") });
    const out = await runWorksheetTool("look_at_pages", { document: "schwab.pdf", pages: [3, 1, 3] }, fixture(), looked);
    expect(looked.lookAtPages).toHaveBeenCalledWith("f1", [3, 1]);
    expect(fenced(out.result)).toBe(true);
    expect(out.result).toContain("Market value 431,050");
    expect(out.ops).toEqual([]);
  });

  it("stage_rows adds a staging row, refs the worksheet row, and adds holdings", async () => {
    const state = fixture();
    const out = await runWorksheetTool(
      "stage_rows",
      {
        table: "t-accounts",
        rows: [{ row: "w2", section: "taxable", cells: { accountName: "Old Brokerage", currentValue: "1200" }, holdings: [{ row: "wh2", ticker: "AAPL", shares: 5 }] }],
      },
      state,
      context(),
    );
    expect(out.ops).toEqual([
      { layer: "staging", op: { op: "addRow", sectionId: "taxable", rowId: "id-1", cells: { accountName: "Old Brokerage", currentValue: "1200" } } },
      { layer: "ws", op: { op: "setRowRef", tableId: "t-accounts", rowId: "w2", ref: { rowId: "id-1" } } },
      { layer: "staging", op: { op: "addHolding", sectionId: "taxable", rowId: "id-1", holdingId: "id-2", holding: { ticker: "AAPL", shares: 5 } } },
      { layer: "ws", op: { op: "setRowRef", tableId: "t-holdings", rowId: "wh2", ref: { rowId: "id-1", holdingId: "id-2" } } },
    ]);
    const next = apply(state, out);
    expect(next.sections.taxable[0]).toMatchObject({ id: "id-1", cells: { accountName: { value: "Old Brokerage", by: "chat" }, currentValue: { value: 1200 } } });
    expect(next.sections.taxable[0].holdings).toEqual([expect.objectContaining({ id: "id-2", ticker: "AAPL", shares: 5, by: "chat" })]);
    expect(next.worksheet.tables[1].rows[1].ref).toEqual({ rowId: "id-1", holdingId: "id-2" });
    expect(out.summary).toBe("Got 1 row from Accounts ready for the plan (1 new, 1 holding)");
  });

  it("stage_rows on a referenced row sets cells instead of adding", async () => {
    const out = await runWorksheetTool(
      "stage_rows",
      { table: "t-accounts", rows: [{ row: "w1", section: "retirement", cells: { owner: "Client", last4: "4821" } }] },
      fixture(),
      context(),
    );
    expect(out.ops).toEqual([
      { layer: "staging", op: { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "owner", value: "Client" } },
      { layer: "staging", op: { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "last4", value: "4821" } },
    ]);
  });

  it("accepts the long row ids fill_from_staging makes from UUIDs", async () => {
    const uuid = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-${String(n).repeat(12)}`;
    const [tableId, accountId, holdingId] = [uuid(1), uuid(2), uuid(3)];
    let state = fixture();
    state.sections.taxable = [
      { id: accountId, sourceFileIds: ["f1"], cells: { accountName: doc("Joint Brokerage") }, holdings: [{ ...ira.holdings![0], id: holdingId }] },
    ];
    state.worksheet.tables.push({ ...structuredClone(holdings), id: tableId, rows: [] });
    const filled = await runWorksheetTool("fill_from_staging", { table: tableId, sections: ["taxable"], holdings: true }, state, context());
    state = apply(state, filled);
    const rowId = `${tableId}/${accountId}/${holdingId}`;
    expect(rowId.length).toBeGreaterThan(100);
    expect(state.worksheet.tables[2].rows.map((r) => r.id)).toEqual([rowId]);

    const set = await runWorksheetTool("set_cells", { table: tableId, row: rowId, cells: { Shares: "11" } }, state, context());
    expect(set.ops).toHaveLength(1);
    expect((await runWorksheetTool("propose_plan_update", { rows: [rowId] }, state, context())).propose).toEqual([accountId]);
    expect((await runWorksheetTool("remove_rows", { table: tableId, rows: [rowId], reason: "Sold" }, state, context())).ops).toHaveLength(2);
  });

  it("set_columns keeps the text and bindings of columns it re-lists, renames by id, and adds new ones", async () => {
    const state = fixture();
    const out = await runWorksheetTool(
      "set_columns",
      {
        table: "t-accounts",
        columns: [{ header: "account" }, { header: "Type", bind: "none" }, { id: "Value", header: "Balance" }, { header: "Note" }, { header: "Beneficiary" }],
      },
      state,
      context(),
    );
    expect(out.ops).toEqual([
      {
        layer: "ws",
        op: {
          op: "setColumns",
          tableId: "t-accounts",
          columns: [
            { id: "c-name", header: "account", bind: { kind: "cell", columnId: "accountName" } },
            { id: "c-type", header: "Type" },
            { id: "c-value", header: "Balance", bind: { kind: "cell", columnId: "currentValue" } },
            { id: "c-note", header: "Note" },
            { id: "id-1", header: "Beneficiary" },
          ],
        },
      },
    ]);
    const table = apply(state, out).worksheet.tables[0];
    expect(table.rows[1].cells).toEqual({ "c-name": "Old 529", "c-note": "from the fact finder" });
    expect(cellText(apply(state, out), table.rows[0], table.columns[2]).text).toBe("$431,050.00");
    await expect(
      runWorksheetTool("set_columns", { table: "t-accounts", columns: [{ id: "Nope", header: "X" }] }, state, context()),
    ).rejects.toThrow('Accounts has no column "Nope" to rename.');
  });

  it("propose_plan_update maps holding rows to their account and refuses unstaged rows", async () => {
    const state = fixture();
    const out = await runWorksheetTool("propose_plan_update", { rows: ["w1", "wh1"] }, state, context());
    expect(out.ops).toEqual([]);
    expect(out.propose).toEqual(["r1"]);
    await expect(runWorksheetTool("propose_plan_update", { table: "t-accounts" }, state, context())).rejects.toThrow(
      "Stage these rows first: w2",
    );
  });

  it("runs a staging tool through runTool, its ops on the staging layer", async () => {
    const state = fixture();
    const out = await runWorksheetTool("set_cell", { rowId: "r1", columnId: "owner", value: "Client" }, state, context());
    expect(out.ops).toEqual([{ layer: "staging", op: { op: "setCell", sectionId: "retirement", rowId: "r1", columnId: "owner", value: "Client" } }]);
    await expect(runWorksheetTool("reread_document", { fileName: "schwab.pdf", question: "x" }, state, context())).rejects.toThrow(
      'Unknown tool "reread_document".',
    );
  });

  it("redacts SSNs in a refusal", async () => {
    await expect(
      runWorksheetTool("set_cells", { table: "t-accounts", row: "w1", cells: { "123-45-6789": "x" } }, fixture(), context()),
    ).rejects.toThrow(/has no column "\[REDACTED-SSN\]"/);
  });
});
