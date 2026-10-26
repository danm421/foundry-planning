// src/lib/fact-finder/worksheet/tools.ts
import { z } from "zod";
import { redactSsns } from "@/lib/extraction/redact-ssn";
import { fenceUntrusted } from "../chat/fence";
import {
  HOLDING_INPUT_FIELDS,
  HOLDING_INPUT_PARAMS,
  REREAD_MAX_CHARS,
  STAGING_TOOL_DEFS,
  findDocument,
  fn,
  hasTickerOrName,
  parseArgs,
  runTool,
  type Param,
} from "../chat/tools";
import { quote } from "../chat/view";
import type { ClientOp } from "../ops";
import { FACT_FINDER_SECTIONS, findSection, isListLike } from "../schema";
import { holdingKey, locateRow } from "../state";
import { HOLDING_FIELDS, type FactFinderState } from "../types";
import { parseBinding } from "./bindings";
import { fillRows } from "./from-staging";
import { columnByHeader, findTable, type WsOp } from "./ops";
import { cellText } from "./render";
import { applyTurnOps, type TurnOp } from "./turn-ops";
import type { WsBinding, WsColumn, WsRow, WsTable } from "./types";
import { tableView } from "./view";

/**
 * The worksheet chat's tools. Worksheet tools name tables and rows by id and
 * columns by header, as the worksheet view shows them; each turns its
 * arguments into `TurnOp`s and checks them by applying them to the state it
 * was given — the turn loop applies them for real. The staging tools are the
 * fact-finder chat's own (`runTool`). There is no save tool:
 * `propose_plan_update` only asks the advisor.
 */

export interface WsToolContext {
  /** The import's live files, for document names. */
  files: { id: string; name: string }[];
  /** A file's page text, SSNs already redacted (`page-text.ts` `documentPages`). */
  documentPages(fileId: string): Promise<string[]>;
  /** What chosen pages of a file show, read from their images (`look.ts`). */
  lookAtPages(fileId: string, pages: number[]): Promise<string>;
  /** The plan's current details as text (`planView`). */
  planText(): Promise<string>;
  newId(): string;
}

export interface WsToolOutcome {
  ops: TurnOp[];
  /** The transcript's tool line, in plain words. */
  summary: string;
  /** What the model sees, fenced. */
  result: string;
  /** propose_plan_update only: the staging rows to review after the reply commits. */
  propose?: string[];
}

/** The most pages `look_at_pages` reads at once. */
export const MAX_LOOK_PAGES = 4;

const SECTION_IDS = FACT_FINDER_SECTIONS.map((s) => s.id);
const STAGING_COLUMN_IDS = new Set(FACT_FINDER_SECTIONS.flatMap((s) => s.columns.map((c) => c.id)));
const STAGING_TOOLS = new Set(STAGING_TOOL_DEFS.map((d) => d.function.name));

const tableParam: Param = { type: "string", description: "The table's id, as the worksheet shows it (after ##)." };
const rowParam: Param = { type: "string", description: "The row's id, as the worksheet shows it." };
const cellsParam: Param = {
  type: "object",
  description: "Column header → text, headers as the table shows them.",
};
const documentParam: Param = { type: "string", description: "The document's name, as the Documents list shows it." };
const bindParam: Param = {
  type: "string",
  description:
    'Optional. "cell:<staging column id>" (e.g. cell:currentValue), "holding:<field>" ' +
    `(${HOLDING_FIELDS.join(", ")}) or "section". Leave it out for a column of your own text.`,
};

const WORKSHEET_TOOL_DEFS = [
  fn(
    "create_table",
    "Add a table to the worksheet, columns left to right. A column without a bind holds the text you write " +
      "(add_rows, set_cells). A bound column shows a staging value instead, on rows that point at a staging row: " +
      '"cell:<column id>" shows that staging column (read_section lists the ids), "holding:<field>" shows a ' +
      'holding\'s field on holding rows, and "section" shows which staging section the row is in. ' +
      "Returns the new table's id.",
    {
      title: { type: "string", description: "The table's title, by topic (Accounts, Income, Insurance policies …)." },
      columns: {
        type: "array",
        description: "The columns, left to right.",
        items: { type: "object", description: "One column.", properties: { header: { type: "string", description: "The column header." }, bind: bindParam }, required: ["header"] },
      },
      note: { type: "string", description: "Optional. A line shown under the title." },
    },
    ["title", "columns"],
  ),
  fn(
    "update_table",
    "Rename a table or change the note under its title. An empty note removes it.",
    { table: tableParam, title: { type: "string", description: "The new title." }, note: { type: "string", description: "The new note." } },
    ["table"],
  ),
  fn(
    "remove_table",
    "Delete a table from the worksheet. The staging rows it showed stay in staging.",
    { table: tableParam },
    ["table"],
  ),
  fn(
    "set_columns",
    "Replace a table's columns, left to right. List every column the table keeps, not only new ones: columns " +
      "left out are dropped with their text. A column whose header matches a current one keeps that column's " +
      "text and binding. To rename a column and keep its text, give its current header as id. A column " +
      'given no bind keeps the binding it had; bind "none" removes it.',
    {
      table: tableParam,
      columns: {
        type: "array",
        description: "Every column, left to right.",
        items: {
          type: "object",
          description: "One column.",
          properties: {
            id: { type: "string", description: "Optional. The current header of the column this one renames." },
            header: { type: "string", description: "The column header." },
            bind: { ...bindParam, description: `${bindParam.description} "none" removes a binding.` },
          },
          required: ["header"],
        },
      },
    },
    ["table", "columns"],
  ),
  fn(
    "fill_from_staging",
    "Add a row for each staging row of these sections that the table doesn't show yet (statement and " +
      "fact-finder form readings land in staging). With holdings: true, one row per holding of those accounts " +
      "instead. Rows the table already shows are skipped, so calling it again adds only what's new. The rows' " +
      "values show through the table's bound columns.",
    {
      table: tableParam,
      sections: { type: "array", description: "Staging section ids.", items: { type: "string", description: "A section id.", enum: SECTION_IDS } },
      holdings: { type: "boolean", description: "Optional. true: one row per holding." },
    },
    ["table", "sections"],
  ),
  fn(
    "add_rows",
    "Add rows you write yourself, from what a document says. Leave a value out rather than guess. " +
      "document and page say where the row came from. Returns the new rows' ids.",
    {
      table: tableParam,
      rows: {
        type: "array",
        description: "The rows to add.",
        items: {
          type: "object",
          description: "One row.",
          properties: {
            cells: cellsParam,
            document: { ...documentParam, description: `Optional. ${documentParam.description}` },
            page: { type: "integer", description: "Optional. The page it's on, from 1." },
          },
          required: ["cells"],
        },
      },
    },
    ["table", "rows"],
  ),
  fn(
    "set_cells",
    'Change values in one row ("" empties a cell). In a bound column of a row that points at a staging row, ' +
      "the staging value itself changes — that is what goes to the plan — so write it as the staging column " +
      "expects: dollars as 12500, a percent as 6.5, a date as YYYY-MM-DD, a choice as one of its options. " +
      'A "section" column can\'t be typed. A column of your own text on a row that points at a staging row needs ' +
      "staging too, so the plan update reads the correction.",
    {
      table: tableParam,
      row: rowParam,
      cells: cellsParam,
      staging: {
        type: "object",
        description:
          "Only for a row that points at a staging row, when you change a column of your own text: the staging values " +
          "the correction changes — staging column id → value, written as set_cell expects (a holding row: holding " +
          `field → value, the fields being ${HOLDING_FIELDS.join(", ")}). {} when the plan doesn't read the column.`,
      },
    },
    ["table", "row", "cells"],
  ),
  fn(
    "remove_rows",
    "Delete rows from a table. A row that points at a staging row also moves that staging row to the Removed " +
      "tray with your reason (a holding row removes the holding from its account). restore_row brings a " +
      "staging row back.",
    {
      table: tableParam,
      rows: { type: "array", description: "The rows' ids.", items: rowParam },
      reason: { type: "string", description: "Why they don't belong, in a few words." },
    },
    ["table", "rows", "reason"],
  ),
  fn(
    "read_table",
    "Show a table's rows, up to 120 at a time, starting at fromRow (0 is the first row).",
    { table: tableParam, fromRow: { type: "integer", description: "Optional. The first row to show, from 0." } },
    ["table"],
  ),
  fn(
    "read_document",
    `Read an uploaded document's text, page by page (pages count from 1). Returns up to ${REREAD_MAX_CHARS.toLocaleString("en-US")} ` +
      "characters; when it's cut, it says the fromPage and fromChar to go on from.",
    {
      document: documentParam,
      fromPage: { type: "integer", description: "Optional. The first page to read." },
      fromChar: { type: "integer", description: "Optional. Where to start in fromPage, in characters from 0 — as a cut says." },
      toPage: { type: "integer", description: "Optional. The last page to read." },
    },
    ["document"],
  ),
  fn(
    "look_at_pages",
    `Look at up to ${MAX_LOOK_PAGES} pages of a PDF, or an image, as pictures — a closer reading than the text. ` +
      "Use it to check a value the advisor doubts, or when the text reads badly. It's slow: name only the pages you need.",
    {
      document: documentParam,
      pages: { type: "array", description: `The pages, from 1. At most ${MAX_LOOK_PAGES}.`, items: { type: "integer", description: "A page number." } },
    },
    ["document", "pages"],
  ),
  fn(
    "read_plan",
    "Show the client's current plan details (accounts, debts, incomes, family, policies …), read-only — to " +
      "compare a document with what the plan already has.",
    {},
    [],
  ),
  fn(
    "stage_rows",
    "Get worksheet rows ready for a plan update by putting their values in staging, the form the plan update " +
      "reads. A row that isn't staged yet becomes a new staging row in section, and the worksheet row points at " +
      "it; a row already staged gets these cells set instead. cells is staging column id → value, written as " +
      "set_cell expects (read_section lists a section's columns and options). holdings adds positions to the " +
      "account; give each holding's worksheet row (in any table) so it points at the new holding.",
    {
      table: tableParam,
      rows: {
        type: "array",
        description: "The rows to stage.",
        items: {
          type: "object",
          description: "One row.",
          properties: {
            row: rowParam,
            section: { type: "string", description: "The staging section it belongs in.", enum: SECTION_IDS },
            cells: { type: "object", description: "Staging column id → value." },
            holdings: {
              type: "array",
              description: "Optional. Positions to add to this account.",
              items: {
                type: "object",
                description: "One holding: a ticker or a name, and what else you know.",
                properties: {
                  row: { type: "string", description: "Optional. The worksheet row that shows this holding." },
                  ...HOLDING_INPUT_PARAMS,
                },
              },
            },
          },
          required: ["row", "section", "cells"],
        },
      },
    },
    ["table", "rows"],
  ),
  fn(
    "propose_plan_update",
    "Ask the advisor to approve updating the plan from these rows: name the rows, or a table for all its rows. " +
      "Every row must be staged first (stage_rows). After your reply the advisor sees the change list, record " +
      "by record, and nothing is written to the plan until they save it.",
    {
      rows: { type: "array", description: "Optional. The worksheet rows' ids.", items: rowParam },
      table: { ...tableParam, description: `Optional. ${tableParam.description}` },
    },
    [],
  ),
];

/** OpenAI-style function defs for the worksheet chat, bound with `bindTools`. */
export const WS_TOOL_DEFS = [...WORKSHEET_TOOL_DEFS, ...STAGING_TOOL_DEFS];

/** What each tool does, for the advisor's line when a call is refused. */
const REFUSED: Record<string, string> = {
  create_table: "create that table",
  update_table: "change that table",
  remove_table: "remove that table",
  set_columns: "change those columns",
  fill_from_staging: "fill in that table",
  add_rows: "add those rows",
  set_cells: "change those values",
  remove_rows: "remove those rows",
  read_table: "read that table",
  read_document: "read that document",
  look_at_pages: "look at those pages",
  read_plan: "read the plan",
  stage_rows: "get those rows ready for the plan",
  propose_plan_update: "propose those plan changes",
  set_cell: "change that value",
  clear_cell: "clear that value",
  add_row: "add that row",
  remove_row: "remove that row",
  restore_row: "restore that row",
  merge_rows: "merge those rows",
  set_link: "link that row to the plan",
  set_holding: "change that holding",
  remove_holding: "remove that holding",
  move_holding: "move that holding",
  add_holding: "add that holding",
  read_section: "read that section",
};

/**
 * The advisor's line for a refused call, in plain words. The reason itself goes to the model only: it's written
 * for the model, with row ids and tool words the advisor never sees.
 */
export function refusedLine(tool: string): string {
  return `Couldn't ${Object.hasOwn(REFUSED, tool) ? REFUSED[tool] : "do that"}.`;
}

const id = z.string().min(1).max(100);
/** A worksheet row id: fill_from_staging's holding rows join three ids (`table/row/holding`). */
const rowId = z.string().min(1).max(400);
const cellInput = z.union([z.string().max(2000), z.number()]).transform((v) => String(v).trim());
const cells = z.record(z.string(), cellInput);
const header = z.string().trim().min(1).max(200);
const page = z.number().int().min(1);
const stagingValue = z.union([z.string(), z.number(), z.boolean()]);

const ARGS = {
  create_table: z.object({
    title: z.string().trim().min(1).max(200),
    columns: z.array(z.object({ header, bind: z.string().optional() })).min(1),
    note: z.string().trim().max(1000).optional(),
  }),
  update_table: z
    .object({ table: id, title: z.string().trim().min(1).max(200).optional(), note: z.string().trim().max(1000).optional() })
    .refine((a) => a.title !== undefined || a.note !== undefined, "give a title or a note"),
  remove_table: z.object({ table: id }),
  set_columns: z.object({
    table: id,
    columns: z.array(z.object({ id: z.string().optional(), header, bind: z.string().optional() })).min(1),
  }),
  fill_from_staging: z.object({ table: id, sections: z.array(z.enum(SECTION_IDS)).min(1), holdings: z.boolean().optional() }),
  add_rows: z.object({
    table: id,
    rows: z.array(z.object({ cells, document: z.string().min(1).optional(), page: page.optional() })).min(1).max(200),
  }),
  set_cells: z.object({
    table: id,
    row: rowId,
    cells: cells.refine((c) => Object.keys(c).length > 0, "give at least one cell"),
    staging: z.record(z.string(), stagingValue).optional(),
  }),
  remove_rows: z.object({ table: id, rows: z.array(rowId).min(1), reason: z.string().trim().min(1).max(500) }),
  read_table: z.object({ table: id, fromRow: z.number().int().min(0).optional() }),
  read_document: z.object({
    document: z.string().min(1),
    fromPage: page.optional(),
    fromChar: z.number().int().min(0).optional(),
    toPage: page.optional(),
  }),
  look_at_pages: z.object({
    document: z.string().min(1),
    pages: z.array(page).min(1).max(MAX_LOOK_PAGES, `look at ${MAX_LOOK_PAGES} pages or fewer at a time`),
  }),
  read_plan: z.object({}),
  stage_rows: z.object({
    table: id,
    rows: z
      .array(
        z.object({
          row: rowId,
          section: z.enum(SECTION_IDS),
          cells: z.record(z.string(), stagingValue),
          holdings: z
            .array(z.object({ row: rowId.optional(), ...HOLDING_INPUT_FIELDS }).refine(hasTickerOrName, "give each holding a ticker or a name"))
            .optional(),
        }),
      )
      .min(1)
      .max(100),
  }),
  propose_plan_update: z
    .object({ rows: z.array(rowId).min(1).optional(), table: id.optional() })
    .refine((a) => a.rows !== undefined || a.table !== undefined, "name the rows or a table"),
};
type WsToolName = keyof typeof ARGS;

const argsOf = <N extends WsToolName>(name: N, args: unknown) => parseArgs(name, ARGS[name], args) as z.infer<(typeof ARGS)[N]>;

const ws = (op: WsOp): TurnOp => ({ layer: "ws", op });
const staging = (op: ClientOp): TurnOp => ({ layer: "staging", op });
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Applies the ops to the given state, so anything the layers refuse is refused here with their own message. */
function check(state: FactFinderState, ops: readonly TurnOp[], ctx: WsToolContext): FactFinderState {
  return applyTurnOps(state, ops, { by: "chat", now: new Date().toISOString(), newId: ctx.newId });
}

function done(ops: TurnOp[], summary: string, detail = ""): WsToolOutcome {
  return { ops, summary, result: fenceUntrusted(`Done: ${summary}.${detail ? ` ${detail}` : ""}`) };
}

function tableOf(state: FactFinderState, tableId: string): WsTable {
  const table = state.worksheet.tables.find((t) => t.id === tableId);
  if (!table) {
    const ids = state.worksheet.tables.map((t) => t.id).join(", ") || "none yet";
    throw new Error(`There's no table "${tableId}". The tables are: ${ids}.`);
  }
  return table;
}

function rowOf(table: WsTable, rowId: string): WsRow {
  const row = table.rows.find((r) => r.id === rowId);
  if (!row) throw new Error(`${table.title} has no row "${rowId}".`);
  return row;
}

/** A row by id in whichever table holds it (minted row ids don't repeat across tables). */
function rowAnywhere(state: FactFinderState, rowId: string): { table: WsTable; row: WsRow } {
  const hits = state.worksheet.tables.flatMap((table) => table.rows.filter((r) => r.id === rowId).map((row) => ({ table, row })));
  if (hits.length === 0) throw new Error(`No table has a row "${rowId}".`);
  if (hits.length > 1) throw new Error(`More than one table has a row "${rowId}" — name the table.`);
  return hits[0];
}

function columnOf(table: WsTable, header: string): WsColumn {
  const column = columnByHeader(table, header);
  if (!column) throw new Error(`${table.title} has no column "${header}". Its columns are: ${table.columns.map((c) => c.header).join(", ")}.`);
  return column;
}

/** The section of the staging row a worksheet row points at (a holding row: its account row). */
function stagingSectionOf(state: FactFinderState, row: WsRow): string {
  const at = row.ref ? locateRow(state, row.ref.rowId) : null;
  if (!at) throw new Error(`Row ${row.id} points at a staging row that isn't in staging any more — restore_row brings one back from the Removed tray.`);
  return at.sectionId;
}

/** `undefined` = no binding ("none" or left out); text that isn't a binding throws. */
function bindingOf(text: string | undefined): WsBinding | undefined {
  if (text === undefined || text.trim() === "none") return undefined;
  const binding = parseBinding(text);
  if (!binding || (binding.kind === "cell" && !STAGING_COLUMN_IDS.has(binding.columnId))) {
    throw new Error(
      `"${text}" isn't a binding. Use cell:<staging column id> (read_section lists them), holding:<${HOLDING_FIELDS.join("|")}>, section or none.`,
    );
  }
  return binding;
}

const column = (columnId: string, header: string, bind: WsBinding | undefined): WsColumn => ({ id: columnId, header, ...(bind ? { bind } : {}) });
const columnList = (columns: readonly WsColumn[]) => columns.map((c) => c.header).join(", ");

/** What a summary calls a row: its first non-empty value — never its id, which the advisor never sees. */
function rowName(state: FactFinderState, table: WsTable, row: WsRow): string {
  for (const c of table.columns) {
    const text = cellText(state, row, c).text;
    if (text) return quote(text);
  }
  return "a row";
}

function setColumns(state: FactFinderState, a: z.infer<typeof ARGS.set_columns>, ctx: WsToolContext): WsToolOutcome {
  const table = tableOf(state, a.table);
  const kept = new Set<string>();
  const columns = a.columns.map((c) => {
    const current = c.id !== undefined ? (table.columns.find((x) => x.id === c.id) ?? columnByHeader(table, c.id)) : columnByHeader(table, c.header);
    if (c.id !== undefined && !current) throw new Error(`${table.title} has no column "${c.id}" to rename.`);
    if (current && kept.has(current.id)) throw new Error(`Only one column can keep "${current.header}".`);
    if (current) kept.add(current.id);
    return column(current?.id ?? ctx.newId(), c.header, c.bind === undefined ? current?.bind : bindingOf(c.bind));
  });
  const ops = [ws({ op: "setColumns", tableId: table.id, columns })];
  check(state, ops, ctx);
  return done(ops, `Changed the columns of ${table.title}`, `They are now: ${columnList(columns)}.`);
}

/**
 * A staged row's own-text columns aren't what the plan update reads — stage_rows copied their values into staging. So
 * a correction to one names the staging values it changes (`staging`), or `{}` for a column the plan doesn't read:
 * what saves is the correction, and a change list built before it goes out of date.
 */
function ownTextStagingOps(
  state: FactFinderState,
  table: WsTable,
  row: WsRow,
  ownHeaders: string[],
  values: z.infer<typeof ARGS.set_cells>["staging"],
): TurnOp[] {
  const ref = row.ref;
  if (!ref) {
    if (values && Object.keys(values).length > 0) {
      throw new Error(`Row ${row.id} isn't ready for the plan yet, so it has no staging values — leave staging out (stage_rows stages it).`);
    }
    return [];
  }
  if (values === undefined) {
    if (ownHeaders.length === 0) return [];
    const which = ownHeaders.length === 1 ? `${ownHeaders[0]} is` : `${ownHeaders.join(", ")} are`;
    throw new Error(
      `${rowName(state, table, row)} is ready for the plan, and ${which} your own text, which the plan update doesn't read: ` +
        "call set_cells again with staging — the staging values this correction changes (staging column id → value, as " +
        `set_cell takes it${ref.holdingId ? "; this is a holding row, so its holding's fields" : ""}) — or staging: {} when the plan doesn't read ${ownHeaders.length === 1 ? "it" : "them"}.`,
    );
  }
  const sectionId = stagingSectionOf(state, row);
  return Object.entries(values).map(([key, value]) => {
    if (!ref.holdingId) return staging({ op: "setCell", sectionId, rowId: ref.rowId, columnId: key, value });
    const field = HOLDING_FIELDS.find((f) => f === key);
    if (!field) throw new Error(`A holding row's staging values are its fields: ${HOLDING_FIELDS.join(", ")}.`);
    return staging({ op: "setHolding", sectionId, rowId: ref.rowId, holdingId: ref.holdingId, field, value });
  });
}

function setCells(state: FactFinderState, a: z.infer<typeof ARGS.set_cells>, ctx: WsToolContext): WsToolOutcome {
  const table = tableOf(state, a.table);
  const row = rowOf(table, a.row);
  const own: Record<string, string> = {};
  const ownHeaders: string[] = [];
  const ops: TurnOp[] = [];
  const changed: WsColumn[] = [];
  for (const [header, value] of Object.entries(a.cells)) {
    const col = columnOf(table, header);
    changed.push(col);
    const { bind } = col;
    if (!bind || !row.ref) {
      own[col.id] = value;
      ownHeaders.push(col.header);
      continue;
    }
    if (bind.kind === "section") throw new Error("That column shows where the row sits — it can't be typed.");
    const ref = row.ref;
    const sectionId = stagingSectionOf(state, row);
    if (bind.kind === "cell") {
      ops.push(staging({ op: "setCell", sectionId, rowId: ref.rowId, columnId: bind.columnId, value }));
    } else if (ref.holdingId) {
      ops.push(staging({ op: "setHolding", sectionId, rowId: ref.rowId, holdingId: ref.holdingId, field: bind.field, value }));
    } else {
      throw new Error(`${col.header} shows a holding, and row ${row.id} isn't a holding row.`);
    }
  }
  ops.push(...ownTextStagingOps(state, table, row, ownHeaders, a.staging));
  if (Object.keys(own).length > 0) ops.unshift(ws({ op: "setCells", tableId: table.id, rowId: row.id, cells: own }));
  const next = check(state, ops, ctx);
  const nextRow = findTable(next.worksheet, table.id).rows.find((r) => r.id === row.id) ?? row;
  const reads = changed.map((c) => `${c.header}: ${cellText(next, nextRow, c).text || "(empty)"}`).join("; ");
  return done(ops, `Changed ${changed.map((c) => c.header).join(", ")} on ${rowName(next, table, nextRow)} in ${table.title}`, `It now reads ${reads}.`);
}

function removeRows(state: FactFinderState, a: z.infer<typeof ARGS.remove_rows>, ctx: WsToolContext): WsToolOutcome {
  const table = tableOf(state, a.table);
  const rows = [...new Set(a.rows)].map((rowId) => rowOf(table, rowId));
  const ops: TurnOp[] = [ws({ op: "removeRows", tableId: table.id, rowIds: rows.map((r) => r.id) })];
  // A staging row already in the tray, or a holding already gone, has nothing left to remove; a fixed row
  // (the client's details …) can't leave staging, so only its worksheet row goes.
  const accountRowIds = new Set(rows.flatMap((r) => (r.ref && !r.ref.holdingId ? [r.ref.rowId] : [])));
  const holdingKeys = new Set<string>();
  for (const { ref } of rows) {
    if (!ref?.holdingId || accountRowIds.has(ref.rowId) || holdingKeys.has(`${ref.rowId}/${ref.holdingId}`)) continue;
    const at = locateRow(state, ref.rowId);
    if (!at || !state.sections[at.sectionId][at.index].holdings?.some((h) => h.id === ref.holdingId)) continue;
    holdingKeys.add(`${ref.rowId}/${ref.holdingId}`);
    ops.push(staging({ op: "removeHolding", sectionId: at.sectionId, rowId: ref.rowId, holdingId: ref.holdingId }));
  }
  let trayed = 0;
  for (const rowId of accountRowIds) {
    const at = locateRow(state, rowId);
    const section = at ? findSection(at.sectionId) : undefined;
    if (!at || !section || !isListLike(section)) continue;
    ops.push(staging({ op: "removeRow", sectionId: at.sectionId, rowId, reason: a.reason }));
    trayed++;
  }
  check(state, ops, ctx);
  const went = [
    ...(trayed > 0 ? [`${plural(trayed, "staging row")} went to the Removed tray (restore_row brings one back)`] : []),
    ...(holdingKeys.size > 0 ? [`${plural(holdingKeys.size, "holding")} came off ${holdingKeys.size === 1 ? "its account" : "their accounts"}`] : []),
  ];
  return done(ops, `Removed ${plural(rows.length, "row")} from ${table.title}: ${quote(a.reason)}`, went.length > 0 ? `${went.join("; ")}.` : "");
}

async function readDocument(a: z.infer<typeof ARGS.read_document>, ctx: WsToolContext): Promise<WsToolOutcome> {
  const file = findDocument(ctx.files, a.document);
  const pages = (await ctx.documentPages(file.id)).map((p) => redactSsns(p).text);
  const from = a.fromPage ?? 1;
  const to = Math.min(a.toPage ?? pages.length, pages.length);
  if (from > pages.length) throw new Error(`${quote(file.name)} has ${plural(pages.length, "page")}.`);
  if (to < from) throw new Error("toPage comes before fromPage.");
  const header = `From ${quote(file.name)}, pages ${from}–${to} of ${pages.length}:\n`;
  let body = "";
  let cut: { page: number; char: number } | null = null;
  // fromChar counts into the first page's trimmed text, the same text a cut counts in.
  for (let p = from; p <= to; p++) {
    const start = p === from ? (a.fromChar ?? 0) : 0;
    const text = pages[p - 1].trim().slice(start);
    if (!text) continue;
    const label = `${body ? "\n\n" : ""}[page ${p}${start > 0 ? `, from character ${start}` : ""}]\n`;
    const room = REREAD_MAX_CHARS - header.length - body.length - label.length;
    if (text.length > room) {
      if (room > 0) body += label + text.slice(0, room);
      cut = { page: p, char: start + Math.max(0, room) };
      break;
    }
    body += label + text;
  }
  const more = cut ? `\n\n[cut here, at the length limit — read_document with fromPage: ${cut.page}, fromChar: ${cut.char} goes on]` : "";
  return {
    ops: [],
    summary: `Read ${quote(file.name)}`,
    result: fenceUntrusted(header + (body || "(no readable text on those pages)") + more),
  };
}

async function lookAtPages(a: z.infer<typeof ARGS.look_at_pages>, ctx: WsToolContext): Promise<WsToolOutcome> {
  const file = findDocument(ctx.files, a.document);
  const pages = [...new Set(a.pages)];
  const text = redactSsns(await ctx.lookAtPages(file.id, pages)).text.trim();
  const where = `${pages.length === 1 ? "page" : "pages"} ${pages.join(", ")} of ${quote(file.name)}`;
  return {
    ops: [],
    summary: `Looked closely at ${where}`,
    result: fenceUntrusted(`What ${where} show, read from the page images:\n${text || "(nothing readable on those pages)"}`),
  };
}

function stageRows(state: FactFinderState, a: z.infer<typeof ARGS.stage_rows>, ctx: WsToolContext): WsToolOutcome {
  const table = tableOf(state, a.table);
  const ops: TurnOp[] = [];
  const lines: string[] = [];
  const seen = new Set<string>();
  let added = 0;
  let holdings = 0;
  for (const item of a.rows) {
    const row = rowOf(table, item.row);
    if (seen.has(row.id)) throw new Error(`Row ${row.id} is listed twice — give each row once.`);
    seen.add(row.id);
    let stagingRowId: string;
    let sectionId: string;
    if (row.ref) {
      stagingRowId = row.ref.rowId;
      sectionId = stagingSectionOf(state, row);
      if (sectionId !== item.section) throw new Error(`Row ${row.id} is already staged in ${sectionId}, not ${item.section}.`);
      for (const [columnId, value] of Object.entries(item.cells)) {
        ops.push(staging({ op: "setCell", sectionId, rowId: stagingRowId, columnId, value }));
      }
      lines.push(`${row.id} → staging row ${stagingRowId} (updated)`);
    } else {
      stagingRowId = ctx.newId();
      sectionId = item.section;
      ops.push(
        staging({ op: "addRow", sectionId, rowId: stagingRowId, cells: item.cells }),
        ws({ op: "setRowRef", tableId: table.id, rowId: row.id, ref: { rowId: stagingRowId } }),
      );
      added++;
      lines.push(`${row.id} → new staging row ${stagingRowId} in ${sectionId}`);
    }
    // A position the account already has — the one a holding row shows, or one with the same ticker (else name) — isn't
    // added again: re-staging an account with its holdings would otherwise count them twice.
    const at = row.ref ? locateRow(state, stagingRowId) : null;
    const had = at ? (state.sections[at.sectionId][at.index].holdings ?? []) : [];
    const ids = new Set(had.map((h) => h.id));
    const byKey = new Map<string, string>();
    for (const h of had) {
      const key = holdingKey(h);
      if (key) byKey.set(key, h.id);
    }
    for (const { row: holdingRowId, ...holding } of item.holdings ?? []) {
      const shownAt = holdingRowId === undefined ? null : rowAnywhere(state, holdingRowId);
      const shown = shownAt?.row.ref;
      const key = holdingKey(holding);
      const own = shown?.holdingId && shown.rowId === stagingRowId && ids.has(shown.holdingId) ? shown.holdingId : undefined;
      const existing = own ?? (key ? byKey.get(key) : undefined);
      if (existing) {
        if (shownAt && !shown) {
          ops.push(ws({ op: "setRowRef", tableId: shownAt.table.id, rowId: shownAt.row.id, ref: { rowId: stagingRowId, holdingId: existing } }));
        }
        const label = holding.ticker?.trim().toUpperCase() || holding.name?.trim();
        lines.push(`  ${label}: skipped — the account already has it (holding ${existing})`);
        continue;
      }
      if (shown && !shown.holdingId) throw new Error(`Row ${holdingRowId} shows an account, not a holding — leave it out.`);
      if (shown && shown.rowId !== stagingRowId) {
        throw new Error(`Row ${holdingRowId} already shows a holding of another account — leave it out (move_holding moves a holding to another account).`);
      }
      const holdingId = ctx.newId();
      ops.push(staging({ op: "addHolding", sectionId, rowId: stagingRowId, holdingId, holding }));
      if (shownAt) ops.push(ws({ op: "setRowRef", tableId: shownAt.table.id, rowId: shownAt.row.id, ref: { rowId: stagingRowId, holdingId } }));
      if (key) byKey.set(key, holdingId);
      holdings++;
      lines.push(`  holding ${holdingId}${holdingRowId !== undefined ? ` ← ${holdingRowId}` : ""}`);
    }
  }
  check(state, ops, ctx);
  const extras = [...(added > 0 ? [`${added} new`] : []), ...(holdings > 0 ? [plural(holdings, "holding")] : [])];
  const summary = `Got ${plural(a.rows.length, "row")} from ${table.title} ready for the plan${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`;
  return { ops, summary, result: fenceUntrusted(`Done: ${summary}.\n${lines.join("\n")}`) };
}

function proposePlanUpdate(state: FactFinderState, a: z.infer<typeof ARGS.propose_plan_update>): WsToolOutcome {
  let rows: WsRow[];
  if (a.table !== undefined) {
    const table = tableOf(state, a.table);
    rows = a.rows ? a.rows.map((rowId) => rowOf(table, rowId)) : table.rows;
    if (rows.length === 0) throw new Error(`${table.title} has no rows.`);
  } else {
    rows = (a.rows ?? []).map((rowId) => rowAnywhere(state, rowId).row);
  }
  const unstaged = rows.filter((r) => !r.ref).map((r) => r.id);
  if (unstaged.length > 0) throw new Error(`Stage these rows first: ${unstaged.join(", ")}.`);
  const refs = rows.flatMap((r) => (r.ref ? [{ id: r.id, rowId: r.ref.rowId }] : []));
  const gone = refs.filter((r) => !locateRow(state, r.rowId)).map((r) => r.id);
  if (gone.length > 0) throw new Error(`These rows point at staging rows in the Removed tray: ${gone.join(", ")}.`);
  const propose = [...new Set(refs.map((r) => r.rowId))];
  const summary = `Proposed a plan update for ${plural(propose.length, "record")}`;
  return { ...done([], summary, "After your reply the advisor sees the change list to approve."), propose };
}

async function dispatch(name: string, raw: unknown, state: FactFinderState, ctx: WsToolContext): Promise<WsToolOutcome> {
  switch (name) {
    case "create_table": {
      const a = argsOf(name, raw);
      const tableId = ctx.newId();
      const columns = a.columns.map((c) => column(ctx.newId(), c.header, bindingOf(c.bind)));
      const ops = [ws({ op: "createTable", tableId, title: a.title, columns, ...(a.note ? { note: a.note } : {}) })];
      check(state, ops, ctx);
      return done(ops, `Created the table ${a.title}`, `Its id is ${tableId}; its columns: ${columnList(columns)}.`);
    }
    case "update_table": {
      const a = argsOf(name, raw);
      const table = tableOf(state, a.table);
      const note = a.note === undefined ? {} : { note: a.note === "" ? null : a.note };
      const ops = [ws({ op: "updateTable", tableId: table.id, ...(a.title !== undefined ? { title: a.title } : {}), ...note })];
      check(state, ops, ctx);
      return done(ops, `Updated ${a.title ?? table.title}`);
    }
    case "remove_table": {
      const table = tableOf(state, argsOf(name, raw).table);
      const ops = [ws({ op: "removeTable", tableId: table.id })];
      check(state, ops, ctx);
      return done(ops, `Removed the table ${table.title}`);
    }
    case "set_columns":
      return setColumns(state, argsOf(name, raw), ctx);
    case "fill_from_staging": {
      const a = argsOf(name, raw);
      const table = tableOf(state, a.table);
      const rows = fillRows(state, table.id, { sectionIds: a.sections, holdings: a.holdings }, table);
      const ops = rows.length > 0 ? [ws({ op: "addRows", tableId: table.id, rows })] : [];
      check(state, ops, ctx);
      return done(ops, `Added ${plural(rows.length, "row")} to ${table.title}`, rows.length > 0 ? "" : "It already shows every staging row of those sections.");
    }
    case "add_rows": {
      const a = argsOf(name, raw);
      const table = tableOf(state, a.table);
      const rows = a.rows.map((r): WsRow => {
        if (r.page !== undefined && r.document === undefined) throw new Error("A page needs its document — give both.");
        const own: Record<string, string> = {};
        for (const [header, text] of Object.entries(r.cells)) if (text !== "") own[columnOf(table, header).id] = text;
        const source = r.document === undefined ? undefined : { fileId: findDocument(ctx.files, r.document).id, ...(r.page !== undefined ? { page: r.page } : {}) };
        return { id: ctx.newId(), cells: own, ...(source ? { source } : {}) };
      });
      const ops = [ws({ op: "addRows", tableId: table.id, rows })];
      check(state, ops, ctx);
      return done(ops, `Added ${plural(rows.length, "row")} to ${table.title}`, `The new rows' ids, in order: ${rows.map((r) => r.id).join(", ")}.`);
    }
    case "set_cells":
      return setCells(state, argsOf(name, raw), ctx);
    case "remove_rows":
      return removeRows(state, argsOf(name, raw), ctx);
    case "read_table": {
      const a = argsOf(name, raw);
      const table = tableOf(state, a.table);
      return { ops: [], summary: `Read ${table.title}`, result: fenceUntrusted(tableView(state, table.id, a.fromRow ?? 0, ctx.files)) };
    }
    case "read_document":
      return readDocument(argsOf(name, raw), ctx);
    case "look_at_pages":
      return lookAtPages(argsOf(name, raw), ctx);
    case "read_plan":
      argsOf(name, raw);
      return { ops: [], summary: "Read the plan's current details", result: fenceUntrusted(await ctx.planText()) };
    case "stage_rows":
      return stageRows(state, argsOf(name, raw), ctx);
    case "propose_plan_update":
      return proposePlanUpdate(state, argsOf(name, raw));
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

/**
 * Runs one worksheet-chat tool call against `state`. Throws an `Error` whose
 * message the model can act on (bad arguments, an unknown table, row or
 * header, a value staging refuses); every message, summary and result has
 * its SSNs redacted.
 */
export async function runWorksheetTool(name: string, args: unknown, state: FactFinderState, ctx: WsToolContext): Promise<WsToolOutcome> {
  if (STAGING_TOOLS.has(name)) {
    const outcome = await runTool(name, args, state, { files: ctx.files, newId: ctx.newId });
    return { ...outcome, ops: outcome.ops.map(staging) };
  }
  try {
    const outcome = await dispatch(name, args, state, ctx);
    return { ...outcome, summary: redactSsns(outcome.summary).text, result: redactSsns(outcome.result).text };
  } catch (err) {
    throw new Error(redactSsns(err instanceof Error ? err.message : "That tool call failed.").text);
  }
}
