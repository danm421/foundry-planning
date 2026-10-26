// src/lib/fact-finder/worksheet/ops.ts
import type { Worksheet, WsColumn, WsRow, WsRowRef, WsTable } from "./types";

export class WorksheetOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorksheetOpError";
  }
}

export type WsOp =
  | { op: "createTable"; tableId: string; title: string; note?: string; columns: WsColumn[] }
  | { op: "updateTable"; tableId: string; title?: string; note?: string | null }
  | { op: "removeTable"; tableId: string }
  | { op: "setColumns"; tableId: string; columns: WsColumn[] } // cells of kept column ids survive; others are dropped
  | { op: "addRows"; tableId: string; rows: WsRow[] }
  | { op: "setCells"; tableId: string; rowId: string; cells: Record<string, string> } // column id → text; "" clears
  | { op: "removeRows"; tableId: string; rowIds: string[] }
  | { op: "setRowRef"; tableId: string; rowId: string; ref: WsRowRef }
  | { op: "markComposed"; fileIds: string[] };

export function emptyWorksheet(): Worksheet {
  return { tables: [], composedFileIds: [] };
}

export function findTable(ws: Worksheet, tableId: string): WsTable {
  const table = ws.tables.find((t) => t.id === tableId);
  if (!table) throw new WorksheetOpError(`There is no table "${tableId}".`);
  return table;
}

const norm = (s: string) => s.trim().toLowerCase();

export function columnByHeader(table: WsTable, header: string): WsColumn | undefined {
  return table.columns.find((c) => norm(c.header) === norm(header));
}

function checkColumns(columns: readonly WsColumn[]): void {
  const ids = new Set<string>();
  const headers = new Map<string, string>(); // normalized → first header as written
  for (const c of columns) {
    if (ids.has(c.id)) throw new WorksheetOpError(`A table can't have two columns with the id "${c.id}".`);
    ids.add(c.id);
    const first = headers.get(norm(c.header));
    if (first !== undefined) throw new WorksheetOpError(`A table can't have two "${first}" columns.`);
    headers.set(norm(c.header), c.header.trim());
  }
}

function checkCellKeys(table: WsTable, cells: Record<string, string>): void {
  for (const key of Object.keys(cells)) {
    if (!table.columns.some((c) => c.id === key)) {
      throw new WorksheetOpError(`"${table.title}" has no column "${key}".`);
    }
  }
}

function findRow(table: WsTable, rowId: string): WsRow {
  const row = table.rows.find((r) => r.id === rowId);
  if (!row) throw new WorksheetOpError(`"${table.title}" has no row "${rowId}".`);
  return row;
}

/** Applies every op to a copy; one failure throws and the caller still holds the unchanged input. The result is never `derived`. */
export function applyWsOps(ws: Worksheet, ops: readonly WsOp[]): Worksheet {
  const next: Worksheet = structuredClone({ tables: ws.tables, composedFileIds: ws.composedFileIds });
  for (const op of ops) {
    switch (op.op) {
      case "createTable": {
        if (next.tables.some((t) => t.id === op.tableId)) {
          throw new WorksheetOpError(`There is already a table "${op.tableId}".`);
        }
        checkColumns(op.columns);
        const table: WsTable = { id: op.tableId, title: op.title, columns: op.columns, rows: [] };
        if (op.note !== undefined) table.note = op.note;
        next.tables.push(table);
        break;
      }
      case "updateTable": {
        const table = findTable(next, op.tableId);
        if (op.title !== undefined) table.title = op.title;
        if (op.note === null) delete table.note;
        else if (op.note !== undefined) table.note = op.note;
        break;
      }
      case "removeTable": {
        findTable(next, op.tableId);
        next.tables = next.tables.filter((t) => t.id !== op.tableId);
        break;
      }
      case "setColumns": {
        const table = findTable(next, op.tableId);
        checkColumns(op.columns);
        const kept = new Set(op.columns.map((c) => c.id));
        table.columns = op.columns;
        for (const row of table.rows) {
          row.cells = Object.fromEntries(Object.entries(row.cells).filter(([k]) => kept.has(k)));
        }
        break;
      }
      case "addRows": {
        const table = findTable(next, op.tableId);
        for (const row of op.rows) {
          if (table.rows.some((r) => r.id === row.id)) {
            throw new WorksheetOpError(`"${table.title}" already has a row "${row.id}".`);
          }
          checkCellKeys(table, row.cells);
          table.rows.push(row);
        }
        break;
      }
      case "setCells": {
        const table = findTable(next, op.tableId);
        const row = findRow(table, op.rowId);
        checkCellKeys(table, op.cells);
        for (const [key, value] of Object.entries(op.cells)) {
          if (value === "") delete row.cells[key];
          else row.cells[key] = value;
        }
        break;
      }
      case "removeRows": {
        const table = findTable(next, op.tableId);
        for (const rowId of op.rowIds) findRow(table, rowId);
        const drop = new Set(op.rowIds);
        table.rows = table.rows.filter((r) => !drop.has(r.id));
        break;
      }
      case "setRowRef": {
        findRow(findTable(next, op.tableId), op.rowId).ref = op.ref;
        break;
      }
      case "markComposed": {
        for (const fileId of op.fileIds) {
          if (!next.composedFileIds.includes(fileId)) next.composedFileIds.push(fileId);
        }
        break;
      }
    }
  }
  return next;
}
