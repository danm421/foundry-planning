// src/lib/fact-finder/__tests__/chat-tools.test.ts
import { describe, expect, it } from "vitest";
import { FENCE_CLOSE, FENCE_OPEN } from "../chat/fence";
import { STAGING_TOOL_DEFS, runTool, type ToolContext } from "../chat/tools";
import { applyOps } from "../ops";
import { FACT_FINDER_SECTIONS } from "../schema";
import { emptyFactFinderState } from "../state";
import { HOLDING_FIELDS, type FactFinderState, type FFCell, type FFCellValue, type FFHolding, type FFRow } from "../types";

const AT = "2026-10-12T12:00:00.000Z";
const doc = (value: FFCellValue, extra: Partial<FFCell> = {}): FFCell => ({
  value,
  confidence: 0.92,
  by: "document",
  source: { fileId: "f1", page: 2, snippet: "Joint Checking ending 1234" },
  ...extra,
});
const row = (id: string, cells: Record<string, FFCell>, extra: Partial<FFRow> = {}): FFRow => ({
  id,
  cells,
  sourceFileIds: ["f1"],
  ...extra,
});
const holding = (id: string, ticker: string | null, name: string | null = null): FFHolding => ({
  id,
  ticker,
  name,
  shares: 10,
  price: 100,
  marketValue: 1000,
  costBasis: null,
  by: "document",
});

function fixture(): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    sections: {
      ...s.sections,
      cash: [
        row("c1", { accountName: doc("Joint Checking"), currentValue: doc(12500) }, {
          link: { kind: "existing", recordId: "acct-1", score: 0.74, confirmed: false, by: "auto" },
          linkCandidates: [
            { recordId: "acct-1", label: "Joint Checking ··1234", score: 0.74 },
            { recordId: "acct-2", label: "Savings ··9999", score: 0.52 },
          ],
        }),
        row("c2", { accountName: doc("Joint Checking (copy)") }, { sourceFileIds: ["f2"] }),
      ],
      taxable: [
        row("t1", { accountName: doc("Joint Brokerage") }, { holdings: [holding("h1", "VTI"), holding("h2", "BND")] }),
        row("t2", { accountName: doc("Trust Brokerage") }),
      ],
    },
    removed: [{ sectionId: "cash", row: row("c9", { accountName: doc("Old Savings") }), reason: "Closed in 2025", by: "advisor", at: AT }],
    unassignedHoldings: [{ ...holding("u1", "AAPL", "Apple Inc"), accountHint: "IRA ··4321" }],
  };
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    files: [
      { id: "f1", name: "hendricks-fact-finder.pdf" },
      { id: "f2", name: "schwab-june.pdf" },
    ],
    newId: () => "new-1",
    ...overrides,
  };
}

const chat = { by: "chat" as const, now: AT, newId: () => "unused" };
const fenced = (text: string) => text.startsWith(`${FENCE_OPEN}\n`) && text.endsWith(`\n${FENCE_CLOSE}`);

type ParamSchema = { properties: Record<string, { enum?: readonly string[] }>; required: string[] };
const paramsOf = (name: string) => STAGING_TOOL_DEFS.find((d) => d.function.name === name)!.function.parameters as ParamSchema;

describe("STAGING_TOOL_DEFS", () => {
  it("pins every tool's name, arguments and required arguments, so a renamed argument fails here", () => {
    const shape = Object.fromEntries(
      STAGING_TOOL_DEFS.map((d) => {
        const p = d.function.parameters as ParamSchema;
        return [d.function.name, { args: Object.keys(p.properties), required: p.required }];
      }),
    );
    expect(shape).toEqual({
      set_cell: { args: ["rowId", "columnId", "value"], required: ["rowId", "columnId", "value"] },
      clear_cell: { args: ["rowId", "columnId"], required: ["rowId", "columnId"] },
      add_row: { args: ["sectionId", "cells"], required: ["sectionId", "cells"] },
      remove_row: { args: ["rowId", "reason"], required: ["rowId", "reason"] },
      restore_row: { args: ["rowId"], required: ["rowId"] },
      merge_rows: { args: ["keepRowId", "dropRowId"], required: ["keepRowId", "dropRowId"] },
      set_link: { args: ["rowId", "kind", "recordId"], required: ["rowId", "kind"] },
      set_holding: { args: ["holdingId", "field", "value"], required: ["holdingId", "field", "value"] },
      remove_holding: { args: ["holdingId"], required: ["holdingId"] },
      move_holding: { args: ["holdingId", "toRowId"], required: ["holdingId", "toRowId"] },
      add_holding: { args: ["rowId", "ticker", "name", "shares", "price", "marketValue", "costBasis"], required: ["rowId"] },
      read_section: { args: ["sectionId"], required: ["sectionId"] },
    });
    for (const d of STAGING_TOOL_DEFS) expect(d.type).toBe("function");
  });

  it("pins the enums: list sections for add_row, every section for read_section, holding fields, link kinds", () => {
    const listSections = FACT_FINDER_SECTIONS.filter((s) => s.layout === "list" || s.layout === "transposed").map((s) => s.id);
    expect(paramsOf("add_row").properties.sectionId.enum).toEqual(listSections);
    expect(listSections).toContain("cash");
    expect(listSections).toContain("life");
    expect(listSections).not.toContain("people");
    expect(paramsOf("read_section").properties.sectionId.enum).toEqual(FACT_FINDER_SECTIONS.map((s) => s.id));
    expect(paramsOf("set_holding").properties.field.enum).toEqual([...HOLDING_FIELDS]);
    expect(paramsOf("set_link").properties.kind.enum).toEqual(["existing", "new"]);
  });
});

describe("runTool — cells and rows", () => {
  it("set_cell writes one cell through the schema and reports the stored value", async () => {
    const out = await runTool("set_cell", { rowId: "c1", columnId: "currentValue", value: "$13,000" }, fixture(), context());
    expect(out.ops).toEqual([{ op: "setCell", sectionId: "cash", rowId: "c1", columnId: "currentValue", value: "$13,000" }]);
    expect(out.summary).toBe('Set Current value on "Joint Checking" to 13000');
    expect(fenced(out.result)).toBe(true);
    expect(out.result).toContain('Done: Set Current value on "Joint Checking" to 13000');
    expect(applyOps(fixture(), out.ops, chat).sections.cash[0].cells.currentValue).toEqual({ value: 13000, by: "chat", pinned: true });
  });

  it("refuses an unknown row, an unknown column and a value that doesn't fit, with a reason the model can act on", async () => {
    const state = fixture();
    await expect(runTool("set_cell", { rowId: "nope", columnId: "currentValue", value: 1 }, state, context())).rejects.toThrow(
      'There\'s no row "nope" in the fact finder.',
    );
    await expect(runTool("set_cell", { rowId: "c1", columnId: "colour", value: "red" }, state, context())).rejects.toThrow(
      'Cash Accounts has no column "colour".',
    );
    await expect(runTool("set_cell", { rowId: "c1", columnId: "owner", value: "Neighbor" }, state, context())).rejects.toThrow(
      '"Neighbor" isn\'t one of the options for Owner: Client, Co-client, Joint, Trust / entity.',
    );
    await expect(runTool("set_cell", { rowId: "c1", columnId: "currentValue" }, state, context())).rejects.toThrow(
      /^set_cell got bad arguments: value/,
    );
  });

  it("clear_cell empties one cell", async () => {
    const out = await runTool("clear_cell", { rowId: "c1", columnId: "currentValue" }, fixture(), context());
    expect(out.ops).toEqual([{ op: "clearCell", sectionId: "cash", rowId: "c1", columnId: "currentValue" }]);
    expect(out.summary).toBe('Cleared Current value on "Joint Checking"');
  });

  it("add_row mints the row id with ctx.newId and returns it to the model", async () => {
    const out = await runTool(
      "add_row",
      { sectionId: "income", cells: { incomeName: "Duke pension", type: "Other", annualAmount: 31200, startYear: 2027 } },
      fixture(),
      context(),
    );
    expect(out.ops).toEqual([
      {
        op: "addRow",
        sectionId: "income",
        rowId: "new-1",
        cells: { incomeName: "Duke pension", type: "Other", annualAmount: 31200, startYear: 2027 },
      },
    ]);
    expect(out.summary).toBe('Added "Duke pension" to Other Income');
    expect(out.result).toContain("New row id: new-1.");
    expect(applyOps(fixture(), out.ops, chat).sections.income[0].id).toBe("new-1");
  });

  it("add_row refuses a fixed-row section and an unknown column", async () => {
    await expect(runTool("add_row", { sectionId: "people", cells: {} }, fixture(), context())).rejects.toThrow(
      /^add_row got bad arguments: sectionId/,
    );
    await expect(runTool("add_row", { sectionId: "income", cells: { pension: 1 } }, fixture(), context())).rejects.toThrow(
      'Other Income has no column "pension".',
    );
  });

  it("remove_row moves a row to the Removed tray with its reason; restore_row brings one back", async () => {
    const removed = await runTool("remove_row", { rowId: "c2", reason: "Same account as Joint Checking" }, fixture(), context());
    expect(removed.ops).toEqual([{ op: "removeRow", sectionId: "cash", rowId: "c2", reason: "Same account as Joint Checking" }]);
    expect(removed.summary).toBe('Moved "Joint Checking (copy)" to the Removed tray: "Same account as Joint Checking"');

    const restored = await runTool("restore_row", { rowId: "c9" }, fixture(), context());
    expect(restored.ops).toEqual([{ op: "restoreRow", rowId: "c9" }]);
    expect(restored.summary).toBe('Restored "Old Savings" to Cash Accounts');
    await expect(runTool("restore_row", { rowId: "c1" }, fixture(), context())).rejects.toThrow(
      "That row isn't in the Removed tray.",
    );
  });

  it("merge_rows folds one row into another of the same section, and refuses rows of two sections", async () => {
    const out = await runTool("merge_rows", { keepRowId: "c1", dropRowId: "c2" }, fixture(), context());
    expect(out.ops).toEqual([{ op: "mergeRows", sectionId: "cash", keepRowId: "c1", dropRowId: "c2" }]);
    expect(out.summary).toBe('Merged "Joint Checking (copy)" into "Joint Checking"');
    await expect(runTool("merge_rows", { keepRowId: "c1", dropRowId: "t1" }, fixture(), context())).rejects.toThrow(
      "Only rows of the same section can be merged — those are in Cash Accounts and Taxable Investment Accounts.",
    );
  });
});

describe("runTool — links", () => {
  it("set_link links a row to one of its candidates, or to a new record", async () => {
    const existing = await runTool("set_link", { rowId: "c1", kind: "existing", recordId: "acct-2" }, fixture(), context());
    expect(existing.ops).toEqual([{ op: "setLink", sectionId: "cash", rowId: "c1", link: { kind: "existing", recordId: "acct-2" } }]);
    expect(existing.summary).toBe('Linked "Joint Checking" to "Savings ··9999"');

    const asNew = await runTool("set_link", { rowId: "c2", kind: "new" }, fixture(), context());
    expect(asNew.ops).toEqual([{ op: "setLink", sectionId: "cash", rowId: "c2", link: { kind: "new" } }]);
    expect(asNew.summary).toBe('"Joint Checking (copy)" will be a new record');
  });

  it("set_link refuses a record that isn't one of the row's candidates, a missing record id, and a section with no links", async () => {
    await expect(runTool("set_link", { rowId: "c1", kind: "existing", recordId: "acct-9" }, fixture(), context())).rejects.toThrow(
      '"acct-9" isn\'t one of the candidates for "Joint Checking": acct-1, acct-2.',
    );
    await expect(runTool("set_link", { rowId: "c2", kind: "existing", recordId: "acct-1" }, fixture(), context())).rejects.toThrow(
      '"Joint Checking (copy)" has no candidates to link to — use kind "new", or leave the link to the advisor.',
    );
    await expect(runTool("set_link", { rowId: "c1", kind: "existing" }, fixture(), context())).rejects.toThrow(
      'set_link needs a recordId when kind is "existing".',
    );
    await expect(runTool("set_link", { rowId: "people:Client", kind: "new" }, fixture(), context())).rejects.toThrow(
      "Client & Co-client rows don't link to records.",
    );
  });
});

describe("runTool — holdings", () => {
  it("set_holding and remove_holding find the holding's account by its id", async () => {
    const set = await runTool("set_holding", { holdingId: "h2", field: "shares", value: "12.5" }, fixture(), context());
    expect(set.ops).toEqual([{ op: "setHolding", sectionId: "taxable", rowId: "t1", holdingId: "h2", field: "shares", value: "12.5" }]);
    expect(set.summary).toBe('Set shares of "BND" in "Joint Brokerage" to 12.5');

    const removed = await runTool("remove_holding", { holdingId: "h1" }, fixture(), context());
    expect(removed.ops).toEqual([{ op: "removeHolding", sectionId: "taxable", rowId: "t1", holdingId: "h1" }]);
    expect(removed.summary).toBe('Removed "VTI" from "Joint Brokerage"');
  });

  it("move_holding gives an unassigned holding an account, or moves one between accounts", async () => {
    const assigned = await runTool("move_holding", { holdingId: "u1", toRowId: "t2" }, fixture(), context());
    expect(assigned.ops).toEqual([{ op: "assignHolding", holdingId: "u1", from: "unassigned", to: { sectionId: "taxable", rowId: "t2" } }]);
    expect(assigned.summary).toBe('Moved "AAPL" to "Trust Brokerage"');

    const moved = await runTool("move_holding", { holdingId: "h1", toRowId: "t2" }, fixture(), context());
    expect(moved.ops).toEqual([
      { op: "assignHolding", holdingId: "h1", from: { sectionId: "taxable", rowId: "t1" }, to: { sectionId: "taxable", rowId: "t2" } },
    ]);
  });

  it("add_holding returns an addHolding op", async () => {
    const out = await runTool("add_holding", { rowId: "t2", ticker: "aapl", shares: 5 }, fixture(), context());
    expect(out.ops).toEqual([{ op: "addHolding", sectionId: "taxable", rowId: "t2", holdingId: "new-1", holding: { ticker: "aapl", shares: 5 } }]);
    expect(out.summary).toBe('Added "AAPL" to "Trust Brokerage"');
    expect(out.result).toContain("New holding id: new-1.");
    expect(applyOps(fixture(), out.ops, chat).sections.taxable[1].holdings).toEqual([
      { id: "new-1", ticker: "AAPL", name: null, shares: 5, price: null, marketValue: null, costBasis: null, by: "chat", pinned: true },
    ]);
    await expect(runTool("add_holding", { rowId: "c1", ticker: "VTI" }, fixture(), context())).rejects.toThrow(
      "Cash Accounts rows don't carry holdings.",
    );
    await expect(runTool("add_holding", { rowId: "t2", shares: 5 }, fixture(), context())).rejects.toThrow("a ticker or a name");
  });

  it("refuses an unknown holding, an edit to a holding with no account, a move to a cash account or to its own account", async () => {
    await expect(runTool("remove_holding", { holdingId: "h9" }, fixture(), context())).rejects.toThrow(
      'There\'s no holding "h9". read_section lists every holding with its id.',
    );
    await expect(runTool("set_holding", { holdingId: "u1", field: "shares", value: 3 }, fixture(), context())).rejects.toThrow(
      "That holding isn't in an account yet — use move_holding to give it one first.",
    );
    await expect(runTool("move_holding", { holdingId: "u1", toRowId: "c1" }, fixture(), context())).rejects.toThrow(
      "Cash Accounts rows don't carry holdings.",
    );
    await expect(runTool("move_holding", { holdingId: "h1", toRowId: "t1" }, fixture(), context())).rejects.toThrow(
      'That holding is already in "Joint Brokerage".',
    );
  });
});

describe("runTool — read_section changes nothing", () => {
  it("read_section returns the whole section, fenced", async () => {
    const out = await runTool("read_section", { sectionId: "taxable" }, fixture(), context());
    expect(out.ops).toEqual([]);
    expect(out.summary).toBe("Read Taxable Investment Accounts");
    expect(fenced(out.result)).toBe(true);
    expect(out.result).toContain("  - holding h2:");
  });

  it("refuses a tool it doesn't have", async () => {
    await expect(runTool("save_plan", {}, fixture(), context())).rejects.toThrow('Unknown tool "save_plan".');
  });
});

describe("an SSN never reaches the model through a tool (Review Focus 5)", () => {
  const SSN = "123-45-6789";

  it("is redacted in a refusal", async () => {
    const state = fixture();
    await expect(
      runTool("set_cell", { rowId: "c1", columnId: "currentValue", value: SSN }, state, context()),
    ).rejects.toThrow('"[REDACTED-SSN]" isn\'t a valid Current value (a dollar amount).');
  });
});
