// src/lib/fact-finder/worksheet/view.ts
import { findSection } from "../schema";
import { rowLabel } from "../state";
import type { FactFinderState } from "../types";
import { bindingText } from "./bindings";
import { stagingRowsNotShown, type StagingNotShown } from "./from-staging";
import { findTable } from "./ops";
import { cellText, rowInPlan } from "./render";
import type { WsRow, WsTable } from "./types";

export const VIEW_MAX_ROWS = 120;

type FileNames = { id: string; name: string }[];

function rowLine(state: FactFinderState, table: WsTable, row: WsRow, files: FileNames): string {
  const parts = [`- ${row.id}`];
  if (row.ref) parts.push(`[ref ${row.ref.rowId}${row.ref.holdingId ? `/${row.ref.holdingId}` : ""}]`);
  if (rowInPlan(state, row)) parts.push("[in plan]");
  const values = table.columns.map((c) => `${c.header}: ${cellText(state, row, c).text}`).join(" | ");
  let line = `${parts.join(" ")} | ${values}`;
  if (row.source) {
    const name = files.find((f) => f.id === row.source?.fileId)?.name ?? row.source.fileId;
    line += `  (source: "${name}"${row.source.page !== undefined ? ` p.${row.source.page}` : ""})`;
  }
  return line;
}

function tableBlock(state: FactFinderState, table: WsTable, files: FileNames, fromRow = 0): string {
  const shown = table.rows.slice(fromRow, fromRow + VIEW_MAX_ROWS);
  const more = table.rows.length - fromRow - shown.length;
  return [
    `## ${table.id} "${table.title}"`,
    ...(table.note ? [table.note] : []),
    `Columns: ${table.columns.map((c) => (c.bind ? `${c.header} [${bindingText(c.bind)}]` : c.header)).join(", ")}`,
    ...shown.map((r) => rowLine(state, table, r, files)),
    ...(more > 0 ? [`… ${more} more rows — read_table shows them`] : []),
  ].join("\n");
}

/** `- <rowId> [<sectionId>] <label>`, and its holdings the worksheet doesn't show — one staging row, as the model addresses it. */
export function stagingRowLine(state: FactFinderState, { sectionId, rowId, shown, holdingIds = [] }: StagingNotShown): string {
  const section = findSection(sectionId);
  const row = state.sections[sectionId]?.find((r) => r.id === rowId);
  const label = section && row ? rowLabel(section, row) : (section?.label ?? sectionId);
  const n = holdingIds.length;
  let holdings = "";
  if (shown) holdings = ` (its row is shown; ${n} of its holdings ${n === 1 ? "isn't" : "aren't"})`;
  else if (n > 0) holdings = ` (and its ${n === 1 ? "holding" : `${n} holdings`})`;
  return `- ${rowId} [${sectionId}] ${label}${holdings}`;
}

/** For the model: ids exact, values as the advisor sees them. */
export function worksheetView(state: FactFinderState, files: FileNames): string {
  const blocks = state.worksheet.tables.map((t) => tableBlock(state, t, files));
  const loose = stagingRowsNotShown(state).map((entry) => stagingRowLine(state, entry));
  blocks.push(["## Staging rows not on the worksheet", ...(loose.length ? loose : ["(none)"])].join("\n"));
  return blocks.join("\n\n");
}

/** Up to VIEW_MAX_ROWS rows of one table from `fromRow`. */
export function tableView(state: FactFinderState, tableId: string, fromRow = 0, files: FileNames = []): string {
  return tableBlock(state, findTable(state.worksheet, tableId), files, Math.max(0, fromRow));
}
