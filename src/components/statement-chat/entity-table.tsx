"use client";

import { Fragment, useState, type ReactNode } from "react";
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
  | "enum"
  /** A per-unit quote, which whole dollars destroy: a bond prices per $100
   *  par (99.875 -> "$100"), a money market sits at $1.00, and a sub-dollar
   *  position rounds to "$0" beside a real market value. Separate from
   *  "money" for the same reason "year" is separate from "number". */
  | "price";

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
  /**
   * Real payload keys this column's `edit` writes, for a column that
   * collapses more than one field (e.g. Account type = category + subType,
   * changed together so a partial write is never observable — Task 10
   * review, Important 2/3). When set, `edit`'s `onChange` value MUST be a
   * `Record<string, unknown>` keyed by these names; `EntityTable` calls
   * `onEditCell` once per key instead of once for `column.key` (which, for
   * a column like this, is a synthetic UI grouping, not itself a real
   * payload field). Omit for the common case of one column, one field.
   *
   * Narrowed to `Row`'s own keys (Task 10b) — `ColumnSpec` is already
   * generic over `Row`, so this costs nothing and catches a mistyped field
   * name at compile time instead of silently writing `undefined` at runtime
   * (exactly the shape of Task 10's Important 3 typo).
   */
  fields?: (keyof Row & string)[];
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
  /**
   * Lifts an excluded row into the working set WITHOUT committing it
   * (Task 10 review, CRITICAL). Optional because the brief's unchangeable
   * tests construct `<AccountsTable>` without it — when absent, the
   * "Include anyway" button renders disabled rather than silently doing
   * nothing (a disabled control reads as "not available here"; a live
   * button that does nothing reads as broken).
   */
  onRestore?: (row: Row) => void;
  /** Disables every row's Commit button regardless of its own committed/
   *  pending state (Ruling 95, Task 11b fix round 1). */
  disableCommit?: boolean;
  /**
   * Optional child content for a row. A row this returns a non-null node for
   * gets a leading disclosure button; open, the node renders in its own
   * full-width `<tr>` beneath the row. Returning `null` for a row means that
   * row has nothing to disclose and gets no button — an empty expander reads
   * as broken (same reasoning as `onRestore`'s disabled state above).
   */
  expand?: (row: Row) => ReactNode;
  /** Accessible name for the disclosure button. Defaults to "Show details". */
  expandLabel?: (row: Row) => string;
}

const RIGHT_ALIGN_KINDS: ReadonlySet<ColumnKind> = new Set([
  "money",
  "number",
  "percent",
  "rate",
  "year",
  "price",
]);

function alignFor(column: Pick<ColumnSpec<unknown>, "align" | "kind">): "left" | "right" {
  return column.align ?? (RIGHT_ALIGN_KINDS.has(column.kind) ? "right" : "left");
}

function moneyText(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * A per-unit quote, kept to the precision the advisor has to check it at.
 * Two decimals minimum so $1 reads "$1.00"; four maximum so a bond quoted
 * 99.875 or a fund at 12.3456 survives, without inventing digits a whole
 * number never had.
 */
function priceText(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/**
 * Default, kind-driven cell text for a column with no `render` override.
 * The `default` branch (C3) is deliberate, not laziness — see `ColumnKind`.
 *
 * `"year"` is deliberately NOT grouped with `"number"` (Task 10 review,
 * Important 6): `toLocaleString` would print a calendar year like 2026 as
 * "2,026", which is the same class of formatting error C3 exists to guard
 * against, just in this switch instead of the Row-shape boundary.
 */
function formatValue(kind: ColumnKind, value: unknown): ReactNode {
  if (value === undefined || value === null || value === "") return "—";
  switch (kind) {
    case "money":
      return typeof value === "number" ? moneyText(value) : String(value);
    case "price":
      return typeof value === "number" ? priceText(value) : String(value);
    case "percent":
      return typeof value === "number" ? `${value}%` : String(value);
    case "rate":
      return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : String(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
    case "year":
      return String(value);
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
  onRestore,
  disableCommit,
  expand,
  expandLabel,
}: EntityTableProps<Row>) {
  const [editing, setEditing] = useState<{ rowId: string; key: string } | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = (rowId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(rowId)) next.add(rowId);
      return next;
    });
  // In-flight guard (Task 10 review, Important 7): without it a double-click
  // fires two POSTs before `committedRowIds` can come back around and
  // disable the button. Keyed by rowId rather than a single boolean so
  // committing one row never blocks another.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [commitError, setCommitError] = useState<{ rowId: string; message: string } | null>(null);

  const commit = (rowId: string | undefined) => {
    if (!rowId || pending.has(rowId)) return;
    setCommitError(null);
    setPending((prev) => new Set(prev).add(rowId));
    // `Promise.resolve(...)` normalizes a mock that returns `undefined`
    // (every brief test's `onCommitRows`) as well as a real promise — both
    // need `.catch`/`.finally` to be safe here.
    Promise.resolve(onCommitRows([rowId]))
      .catch((err: unknown) => {
        setCommitError({
          rowId,
          message: err instanceof Error ? err.message : "Could not commit this row.",
        });
      })
      .finally(() => {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        });
      });
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
      // cancel affordance of its own, so this is the one way out of an
      // editor opened by mistake.
      onKeyDown={(e) => {
        if (e.key === "Escape" && editing) setEditing(null);
      }}
    >
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-hair text-xs uppercase tracking-wide text-ink-3">
            {expand && <th className="w-8 px-3 py-2" />}
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
            const isPending = rowId != null && pending.has(rowId);
            const child = expand?.(row);
            const isExpanded = rowId != null && expanded.has(rowId);

            return (
              <Fragment key={rowId ?? i}>
                <tr className="border-b border-hair last:border-0">
                  {expand && (
                    <td className="px-3 py-2 align-top">
                      {child && rowId && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(rowId)}
                          aria-expanded={isExpanded}
                          aria-label={expandLabel?.(row) ?? "Show details"}
                          className="text-ink-3 transition-colors hover:text-accent-ink"
                        >
                          <ChevronIcon open={isExpanded} />
                        </button>
                      )}
                    </td>
                  )}
                  {columns.map((col) => {
                    const align = alignFor(col);
                    const isEditingThis = !!rowId && editing?.rowId === rowId && editing.key === col.key;
                    const canEdit = !!col.edit && !!rowId && !isCommitted;

                    let content: ReactNode;
                    if (isEditingThis && col.edit) {
                      content = col.edit(row, (value) => {
                        if (col.fields && col.fields.length > 0) {
                          const patch = value as Record<string, unknown>;
                          for (const field of col.fields) {
                            onEditCell(rowId as string, field, patch[field]);
                          }
                        } else {
                          onEditCell(rowId as string, col.key, value);
                        }
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
                      disabled={isCommitted || isPending || disableCommit}
                      className="rounded border border-hair px-2 py-1 text-xs text-accent transition-colors hover:border-hair-2 disabled:cursor-default disabled:text-ink-4 disabled:opacity-60"
                    >
                      {isCommitted ? "Committed" : isPending ? "Committing…" : "Commit"}
                    </button>
                    {commitError && commitError.rowId === rowId && (
                      <div className="mt-1 text-xs text-crit">{commitError.message}</div>
                    )}
                  </td>
                </tr>
                {isExpanded && child && (
                  <tr className="border-b border-hair bg-card-2 last:border-0">
                    <td colSpan={columns.length + 2} className="px-3 py-2">
                      {child}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <ExcludedRows excluded={excluded} label={label} onRestore={onRestore} />
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
