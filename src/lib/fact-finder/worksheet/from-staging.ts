// src/lib/fact-finder/worksheet/from-staging.ts
import { FACT_FINDER_SECTIONS, findSection } from "../schema";
import { isBlank, rowHasValues } from "../state";
import type { FactFinderState, FFRow } from "../types";
import { bindingText } from "./bindings";
import type { WsBinding, WsColumn, WsRow, WsRowRef, WsSource, WsTable, Worksheet } from "./types";

export interface StagingFill {
  sectionIds: readonly string[];
  holdings?: boolean;
}

export interface DefaultTable extends StagingFill {
  id: string;
  title: string;
  columns: WsColumn[];
  /** Keep only the columns some row has a value in (the per-section tables). */
  trimColumns?: true;
}

function sourceOf(row: FFRow, holdingSource?: { fileId: string; page?: number }): WsSource | undefined {
  const s = holdingSource ?? Object.values(row.cells).find((c) => c.source?.page !== undefined)?.source;
  if (s) return { fileId: s.fileId, ...(s.page !== undefined ? { page: s.page } : {}) };
  const fileId = row.sourceFileIds[0];
  return fileId ? { fileId } : undefined;
}

function sameRef(a: WsRowRef | undefined, rowId: string, holdingId?: string): boolean {
  return a !== undefined && a.rowId === rowId && a.holdingId === holdingId;
}

/**
 * One row per live staging row with values in `sectionIds` (or per holding of those rows when `holdings`),
 * in section-then-row order, skipping refs `existing` already has. Cells are empty: bound columns render from staging.
 */
export function fillRows(
  state: Pick<FactFinderState, "sections" | "removed">,
  tableId: string,
  fill: StagingFill,
  existing?: WsTable,
): WsRow[] {
  const removedIds = new Set(state.removed.map((r) => r.row.id));
  const shown = (rowId: string, holdingId?: string) => existing?.rows.some((r) => sameRef(r.ref, rowId, holdingId)) ?? false;
  const out: WsRow[] = [];
  for (const sectionId of fill.sectionIds) {
    for (const row of state.sections[sectionId] ?? []) {
      if (removedIds.has(row.id)) continue;
      if (fill.holdings) {
        for (const h of row.holdings ?? []) {
          if (shown(row.id, h.id)) continue;
          const source = sourceOf(row, h.source);
          out.push({ id: `${tableId}/${row.id}/${h.id}`, cells: {}, ref: { rowId: row.id, holdingId: h.id }, ...(source ? { source } : {}) });
        }
      } else if (rowHasValues(row) && !shown(row.id)) {
        const source = sourceOf(row);
        out.push({ id: `${tableId}/${row.id}`, cells: {}, ref: { rowId: row.id }, ...(source ? { source } : {}) });
      }
    }
  }
  return out;
}

function col(header: string, bind: WsBinding): WsColumn {
  return { id: `c-${bindingText(bind).replace(":", "-")}`, header, bind };
}
const cell = (header: string, columnId: string) => col(header, { kind: "cell", columnId });
const holding = (header: string, field: "ticker" | "name" | "shares" | "price" | "marketValue" | "costBasis") =>
  col(header, { kind: "holding", field });

export const DEFAULT_TABLES: readonly DefaultTable[] = [
  {
    id: "t-accounts",
    title: "Accounts",
    sectionIds: ["cash", "taxable", "retirement", "edu"],
    columns: [
      cell("Account", "accountName"),
      col("Type", { kind: "section" }),
      cell("Custodian", "custodian"),
      cell("Owner", "owner"),
      cell("Last 4", "last4"),
      cell("Value", "currentValue"),
      cell("Cost basis", "costBasis"),
    ],
  },
  {
    id: "t-holdings",
    title: "Holdings",
    sectionIds: ["taxable", "retirement", "edu"],
    holdings: true,
    columns: [
      cell("Account", "accountName"),
      holding("Ticker", "ticker"),
      holding("Name", "name"),
      holding("Shares", "shares"),
      holding("Price", "price"),
      holding("Market value", "marketValue"),
      holding("Cost basis", "costBasis"),
    ],
  },
  ...FACT_FINDER_SECTIONS.filter((s) => s.id !== "meta" && !["cash", "taxable", "retirement", "edu"].includes(s.id)).map(
    (s): DefaultTable => ({
      id: `t-${s.id}`,
      title: s.label,
      sectionIds: [s.id],
      trimColumns: true,
      columns: s.columns.map((c) => cell(c.label, c.id)),
    }),
  ),
];

/** DEFAULT_TABLES filled from staging, tables with no rows dropped, `derived: true`, `composedFileIds: []`. */
export function worksheetFromStaging(state: Omit<FactFinderState, "worksheet">): Worksheet {
  const tables: WsTable[] = [];
  for (const def of DEFAULT_TABLES) {
    const rows = fillRows(state, def.id, def);
    if (rows.length === 0) continue;
    let columns = def.columns;
    if (def.trimColumns) {
      const rowIds = new Set(rows.map((r) => r.ref?.rowId));
      const filled = new Set<string>();
      for (const sectionId of def.sectionIds) {
        for (const r of state.sections[sectionId] ?? []) {
          if (!rowIds.has(r.id)) continue;
          for (const [id, c] of Object.entries(r.cells)) if (!isBlank(c.value)) filled.add(id);
        }
      }
      columns = columns.filter((c) => c.bind?.kind === "cell" && filled.has(c.bind.columnId));
    }
    tables.push({ id: def.id, title: def.title, columns: columns.map((c) => ({ ...c })), rows });
  }
  return { tables, composedFileIds: [], derived: true };
}

/** A staging row the worksheet doesn't show, or a shown one (`shown`) some of whose holdings it doesn't. */
export interface StagingNotShown {
  sectionId: string;
  rowId: string;
  shown?: true;
  /** Its holdings no worksheet row shows. */
  holdingIds?: string[];
}

/**
 * Staging rows with values, not in the Removed tray, that no worksheet row references (holding rows count for their
 * account), and holdings no worksheet row references — so a later statement's holdings are owed to the worksheet
 * like its accounts, under an account already shown too.
 */
export function stagingRowsNotShown(state: FactFinderState): StagingNotShown[] {
  const referenced = new Set<string>();
  const holdingsShown = new Set<string>();
  for (const t of state.worksheet.tables) {
    for (const { ref } of t.rows) {
      if (!ref) continue;
      referenced.add(ref.rowId);
      if (ref.holdingId) holdingsShown.add(`${ref.rowId}/${ref.holdingId}`);
    }
  }
  const removedIds = new Set(state.removed.map((r) => r.row.id));
  const out: StagingNotShown[] = [];
  for (const [sectionId, rows] of Object.entries(state.sections)) {
    if (!findSection(sectionId)) continue;
    for (const row of rows) {
      if (!rowHasValues(row) || removedIds.has(row.id)) continue;
      const holdingIds = (row.holdings ?? []).filter((h) => !holdingsShown.has(`${row.id}/${h.id}`)).map((h) => h.id);
      const shown = referenced.has(row.id);
      if (shown && holdingIds.length === 0) continue;
      out.push({ sectionId, rowId: row.id, ...(shown ? { shown: true as const } : {}), ...(holdingIds.length ? { holdingIds } : {}) });
    }
  }
  return out;
}
