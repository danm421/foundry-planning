"use client";

import { useState, type ReactNode } from "react";
import ExcludedRows, { type ExcludedRow } from "./excluded-rows";

/**
 * Mirrors `FieldKind` in `src/domain/forge/detail-fields/types.ts` — NOT
 * imported from there (controller amendment, Task 10): that directory is
 * currently uncommitted in a tree shared with other sessions. This is a
 * deliberate 9-member SUBSET of the real 13-member union (C3); Phase 2's
 * swap therefore only ever WIDENS it. `formatValue`'s `default` branch below
 * is what stays safe on that day — it must never become an exhaustive
 * switch with no fallback.
 *
 * `"rate"` is a decimal fraction (0.03 = 3%); `"percent"` is a whole number
 * (3 = 3%). Collapsing the two would silently be 100x wrong for one of them.
 */
export type ColumnKind =
  | "string"
  | "money"
  | "number"
  | "percent"
  | "rate"
  | "year"
  | "date"
  | "boolean"
  | "enum";

export interface ColumnSpec<Row> {
  /** Payload key on the row. */
  key: string;
  /** Column header text. */
  header: string;
  /** Drives default formatting; ignored when `render` is given. */
  kind: ColumnKind;
  align?: "left" | "right";
  /** Optional override for the default `kind`-driven display. */
  render?: (row: Row) => ReactNode;
  /** Present only on columns the advisor can edit inline. */
  edit?: (row: Row, onChange: (value: unknown) => void) => ReactNode;
}

/** The one thing every entity row is guaranteed to carry (Task 6): a stable
 *  per-import handle assigned at merge time. */
export interface EntityRow {
  __rowId?: string;
}

export interface EntityTableProps<Row extends EntityRow> {
  rows: Row[];
  columns: ColumnSpec<Row>[];
  excluded: ExcludedRow<Row>[];
  committedRowIds: string[];
  onCommitRows: (rowIds: string[]) => Promise<void>;
  onEditCell: (rowId: string, field: string, value: unknown) => void;
}

const RIGHT_ALIGN_KINDS: ReadonlySet<ColumnKind> = new Set([
  "money",
  "number",
  "percent",
  "rate",
  "year",
]);

function alignFor(column: Pick<ColumnSpec<unknown>, "align" | "kind">): "left" | "right" {
  return column.align ?? (RIGHT_ALIGN_KINDS.has(column.kind) ? "right" : "left");
}

function moneyText(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * Default, kind-driven cell text for a column with no `render` override.
 * The `default` branch (C3) is deliberate, not laziness — see `ColumnKind`.
 */
function formatValue(kind: ColumnKind, value: unknown): ReactNode {
  if (value === undefined || value === null || value === "") return "—";
  switch (kind) {
    case "money":
      return typeof value === "number" ? moneyText(value) : String(value);
    case "percent":
      return typeof value === "number" ? `${value}%` : String(value);
    case "rate":
      return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : String(value);
    case "number":
    case "year":
      return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
    case "boolean":
      return value ? "Yes" : "No";
    default:
      // "string" | "date" | "enum" — and any kind a future, wider union adds.
      return String(value);
  }
}

function rowValue<Row>(row: Row, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

/**
 * Generic, entity-agnostic table. Knows nothing about accounts (or any other
 * entity shape) — everything domain-specific arrives through `columns`
 * (controller amendment, Task 10). Phase 2 reuses this unchanged for
 * annuities, policies, holdings, and the rest of the ~28 entity types,
 * supplying their own column specs.
 */
export default function EntityTable<Row extends EntityRow>({
  rows,
  columns,
  excluded,
  committedRowIds,
  onCommitRows,
  onEditCell,
}: EntityTableProps<Row>) {
  const [editing, setEditing] = useState<{ rowId: string; key: string } | null>(null);

  const commit = (rowId: string | undefined) => {
    if (!rowId) return;
    void onCommitRows([rowId]);
  };

  // Reused to label an excluded row with the same identity the main table
  // shows for it — the first column, by the convention every entity's
  // column spec follows (name/label first).
  const label = (row: Row): ReactNode => {
    const first = columns[0];
    if (!first) return null;
    return first.render ? first.render(row) : formatValue(first.kind, rowValue(row, first.key));
  };

  return (
    <div
      className="overflow-x-auto"
      // Escape backs out of an in-progress cell edit without committing a
      // change (ui-ux-pro-max `escape-routes`) — the `edit` renderer has no
      // cancel affordance of its own (its only callback is `onChange`), so
      // this is the one way out of a dropdown opened by mistake.
      onKeyDown={(e) => {
        if (e.key === "Escape" && editing) setEditing(null);
      }}
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-hair text-xs uppercase tracking-wide text-ink-3">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 font-medium ${alignFor(col) === "right" ? "text-right" : "text-left"}`}
              >
                {col.header}
              </th>
            ))}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const rowId = row.__rowId;
            const isCommitted = rowId != null && committedRowIds.includes(rowId);

            return (
              <tr key={rowId ?? i} className="border-b border-hair last:border-0">
                {columns.map((col) => {
                  const align = alignFor(col);
                  const isEditingThis = !!rowId && editing?.rowId === rowId && editing.key === col.key;
                  const canEdit = !!col.edit && !!rowId && !isCommitted;

                  let content: ReactNode;
                  if (isEditingThis && col.edit) {
                    content = col.edit(row, (value) => {
                      onEditCell(rowId as string, col.key, value);
                      setEditing(null);
                    });
                  } else {
                    const display = col.render ? col.render(row) : formatValue(col.kind, rowValue(row, col.key));
                    content = canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing({ rowId: rowId as string, key: col.key })}
                        className={`w-full ${align === "right" ? "text-right" : "text-left"} text-ink hover:text-accent-ink`}
                      >
                        {display}
                      </button>
                    ) : (
                      display
                    );
                  }

                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${align === "right" ? "tabular text-right" : "text-ink"}`}
                    >
                      {content}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => commit(rowId)}
                    disabled={isCommitted}
                    className="rounded border border-hair px-2 py-1 text-xs text-accent transition-colors hover:border-hair-2 disabled:cursor-default disabled:text-ink-4 disabled:opacity-60"
                  >
                    {isCommitted ? "Committed" : "Commit"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ExcludedRows excluded={excluded} label={label} onInclude={(row) => commit(row.__rowId)} />
    </div>
  );
}
