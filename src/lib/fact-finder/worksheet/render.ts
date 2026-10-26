// src/lib/fact-finder/worksheet/render.ts
import { findSection, type ColumnKind } from "../schema";
import { cellNeedsCheck, locateRow } from "../state";
import type { FactFinderState, FFCellValue, FFHolding } from "../types";
import type { WsColumn, WsRow, WsTable } from "./types";

export interface WsCellText {
  text: string;
  bound: boolean;
  check: boolean;
}

function fmt(value: number, minimumFractionDigits: number, maximumFractionDigits: number, currency?: boolean): string {
  return new Intl.NumberFormat("en-US", {
    ...(currency ? { style: "currency", currency: "USD" } : {}),
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/** A staging value as the worksheet shows it: money as $12,500.00, a percent as 4.5%, a check box as Yes / No. */
export function valueText(value: FFCellValue | undefined, kind: ColumnKind): string {
  if (value === null || value === undefined || value === "") return "";
  if (kind === "check" && typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (kind === "money") return fmt(value, 2, 2, true); // always the cents, as typed money shows them: $6,250.00
    if (kind === "percent") return `${fmt(value, 0, 6)}%`;
    if (kind === "number") return fmt(value, 0, 6);
  }
  return String(value);
}

/** One field of a holding as the worksheet shows it. */
export function holdingText(h: FFHolding, field: string): string {
  switch (field) {
    case "shares":
      return valueText(h.shares, "number");
    case "price":
      return h.price === null ? "" : fmt(h.price, 2, 4, true);
    case "marketValue":
      return valueText(h.marketValue, "money");
    case "costBasis":
      return valueText(h.costBasis, "money");
    default: {
      const v = field === "ticker" ? h.ticker : field === "name" ? h.name : null;
      return v ?? "";
    }
  }
}

/** Bound column + referenced row → the staging value, formatted; otherwise the row's own text. */
export function cellText(state: FactFinderState, row: WsRow, column: WsColumn): WsCellText {
  const own = { text: row.cells[column.id] ?? "", bound: false, check: false };
  const { bind } = column;
  if (!bind || !row.ref) return own;
  const loc = locateRow(state, row.ref.rowId);
  const stagingRow = loc ? state.sections[loc.sectionId][loc.index] : undefined;
  const bound = (text: string, check = false): WsCellText => ({ text, bound: true, check });
  if (!loc || !stagingRow) return bound("");
  const section = findSection(loc.sectionId);
  if (bind.kind === "section") return bound(section?.label ?? "");
  if (bind.kind === "holding") {
    const holding = stagingRow.holdings?.find((h) => h.id === row.ref?.holdingId);
    return bound(holding ? holdingText(holding, bind.field) : "");
  }
  const cell = stagingRow.cells[bind.columnId];
  const kind = section?.columns.find((c) => c.id === bind.columnId)?.kind ?? "text";
  return bound(valueText(cell?.value, kind), cellNeedsCheck(cell));
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** GitHub-flavored markdown of the table as shown. */
export function tableMarkdown(state: FactFinderState, table: WsTable): string {
  const line = (cells: string[]) => `| ${cells.map(escapeMd).join(" | ")} |`;
  return [
    line(table.columns.map((c) => c.header)),
    line(table.columns.map(() => "---")),
    ...table.rows.map((row) => line(table.columns.map((c) => cellText(state, row, c).text))),
  ].join("\n");
}

/** The row's staging row (a holding row: its account row) is in `state.applied`. */
export function rowInPlan(state: FactFinderState, row: WsRow): boolean {
  const ref = row.ref;
  return ref ? (state.applied ?? []).some((a) => a.rowId === ref.rowId) : false;
}
