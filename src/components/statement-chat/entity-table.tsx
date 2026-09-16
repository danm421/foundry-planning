"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { FieldKind } from "@/domain/forge/detail-fields";
import { columnTotal } from "@/lib/statement-chat/column-totals";
import ExcludedRows, { type ExcludedRow } from "./excluded-rows";

/**
 * The map's own `FieldKind` (`src/domain/forge/detail-fields/types.ts`), widened
 * by `"price"` — a per-unit quote the map has no notion of, added by the
 * holdings wave for bond/fund/money-market quotes. Imported rather than
 * mirrored (Task 12) now that the map is committed (`ba2e21b2f`) — that only
 * ever WIDENS the 9-member subset Phase 1 declared here by hand, so it can
 * never silently drop a kind `formatValue` relies on. `formatValue`'s
 * `default` branch below is what stays safe when a kind neither switch names
 * arrives — it must never become an exhaustive switch with no fallback.
 *
 * `"rate"` is a decimal fraction (0.03 = 3%); `"percent"` is a whole number
 * (3 = 3%). Collapsing the two would silently be 100x wrong for one of them.
 */
export type ColumnKind =
  | FieldKind
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
  /**
   * Optional override for the default `kind`-driven display.
   *
   * `meta.isCommitted` is handed down for the same reason `expand`'s is: a
   * cell that renders its OWN control (rather than going through `edit`) has
   * to withhold it once the row is committed, and re-deriving that from a
   * copy of `committedRowIds` in the caller's closure is a second source of
   * truth that can drift from this component's.
   */
  render?: (row: Row, meta: { isCommitted: boolean }) => ReactNode;
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
  /**
   * Sum this column into the table's totals row.
   *
   * Opt-in per column rather than "every `money` column", because the accounts
   * spec has TWO of those (Value and Basis) and only one of them is a figure
   * the advisor reconciles against the statement in hand. A blanket rule would
   * print a basis total nobody asked for, beside the one they did.
   */
  total?: boolean;
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
   * Accessible name for the `<table>` element. Optional because Phase 1's
   * single-table pages never needed one; Phase 2 renders several tables on
   * one page, so each needs a name a screen reader (and this task's own
   * `getByRole("table", { name })`) can tell apart.
   */
  ariaLabel?: string;
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
   * Why THIS row cannot be committed yet, or null when it can. A row this
   * returns a reason for gets a disabled Commit button with the reason beside
   * it.
   *
   * Needed because every commit module silently SKIPS a row it cannot resolve
   * (an ambiguous account match, say): the POST succeeds, the row writes
   * nothing, and the button reports success for work that never happened. A
   * live button that does nothing is the worse half of that — so the state is
   * made visible and the click is withheld until the advisor resolves it.
   */
  commitBlockedReason?: (row: Row) => string | null;
  /**
   * Optional child content for a row. A row this returns a non-null node for
   * gets a leading disclosure button; open, the node renders in its own
   * full-width `<tr>` beneath the row. Returning `null` for a row means that
   * row has nothing to disclose and gets no button — an empty expander reads
   * as broken (same reasoning as `onRestore`'s disabled state above).
   */
  /**
   * `meta.isCommitted` is handed DOWN rather than recomputed by the caller:
   * this component already owns commit state (it withholds `canEdit` and
   * disables the Commit button from the same flag), and a second
   * `committedRowIds.includes(...)` in a caller's closure is a copy that can
   * drift from this one.
   */
  expand?: (row: Row, meta: { isCommitted: boolean }) => ReactNode;
  /** Accessible name for the disclosure button. Defaults to "Show details". */
  expandLabel?: (row: Row) => string;
  /**
   * The two things `commitBlockedReason` cannot express, because neither one
   * blocks the commit: a sub-threshold-confidence marker, and Add-vs-Update
   * wording driven by the row's match kind. Returning `{}` (or omitting the
   * prop) renders nothing extra — Phase 1's `accounts-table.tsx` never
   * passes this and is unaffected.
   */
  // "Update" is representable again (Phase 3A, Task 2) because
  // `buildWriteRequest` now builds one, for an entity that declared
  // `updateSemantics`. Ruling 34 had removed the caption when the writer
  // turned out to POST a create for every non-array entity, so a row
  // captioned "Update" was the one it would have DUPLICATED. The caller owns
  // that correctness — this union only says which words exist.
  rowNotice?: (row: Row) => { needsReview?: boolean; action?: "Add" | "Update" };
  /**
   * What one row IS, for the totals row's count ("25 accounts"). Defaults to
   * rows, which is the honest generic answer but reads as internal language on
   * an advisor screen — every real table should name its own entity.
   *
   * Only consulted when some column opts into `total`.
   */
  totalsNoun?: { one: string; many: string };
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
 * Returns a `string`, not a `ReactNode`, and is EXPORTED — `holdings-table.tsx`
 * renders `ColumnSpec`s of its own but needs plain text for an `aria-label`,
 * which cannot hold JSX. It used to keep a private copy of this switch for
 * that, and the copy was byte-identical for every kind the two tables share;
 * adding a kind to one and not the other would have produced an accessible
 * name disagreeing with the figure beside it — the exact drift that copy was
 * written to prevent, one scope up. A string IS a ReactNode, so this file's
 * own JSX use is unaffected.
 *
 * `"year"` is deliberately NOT grouped with `"number"` (Task 10 review,
 * Important 6): `toLocaleString` would print a calendar year like 2026 as
 * "2,026", which is the same class of formatting error C3 exists to guard
 * against, just in this switch instead of the Row-shape boundary.
 */
export function formatValue(kind: ColumnKind, value: unknown): string {
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
  commitBlockedReason,
  expand,
  expandLabel,
  ariaLabel,
  rowNotice,
  totalsNoun = { one: "row", many: "rows" },
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

  // The figures under the table, for every column that opted into `total`.
  //
  // Computed over `rows` — the set the table is SHOWING — so the footer can
  // never disagree with the rows above it. That one rule settles the cases
  // that look like separate decisions: a rollup `detectRollups` moved into
  // `excluded` is not summed (it is "a total covering N accounts already
  // listed", so adding it would double count the household), one the advisor
  // lifts back with "Include anyway" starts counting because it is then a row,
  // and a committed row keeps counting because it is still on screen.
  //
  // Null for a table with nothing to total, and for an empty one — a footer
  // reading "0 accounts · $0" under no rows states a total nobody computed.
  //
  // Derived inline, NOT memoized, following this feature's own precedent
  // (`summarizeMapWarnings` in `chat-surface.tsx`): the input is bounded by
  // accounts-per-import, and a `useMemo` keyed on `columns` would recompute
  // every render anyway — the only caller builds its column spec inline, so
  // the dependency is a fresh array identity each time. A memo that never
  // caches is just a claim to future readers that this path is cached.
  const totalledColumns = columns.filter((col) => col.total);
  const totals =
    totalledColumns.length > 0 && rows.length > 0
      ? new Map(
          totalledColumns.map(
            (col) =>
              [col.key, columnTotal(rows as unknown as Record<string, unknown>[], col.key)] as const,
          ),
        )
      : null;

  // Which totalled columns could not cover every row, for the footnote under
  // the figures. Derived from `totals` so the sentence and the sum can never
  // disagree about whether there is a gap.
  const shortfalls = totalledColumns.flatMap((col) => {
    const missing = totals?.get(col.key)?.missing ?? 0;
    return missing > 0 ? [{ header: col.header, missing }] : [];
  });

  // Reused to label an excluded row with the same identity the main table
  // shows for it — the first column, by the convention every entity's
  // column spec follows (name/label first).
  const label = (row: Row): ReactNode => {
    const first = columns[0];
    if (!first) return null;
    return first.render
      ? first.render(row, {
          isCommitted: row.__rowId != null && committedRowIds.includes(row.__rowId),
        })
      : formatValue(first.kind, rowValue(row, first.key));
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
      <table className="w-full text-left text-sm" aria-label={ariaLabel}>
        <thead>
          <tr className="border-b border-hair text-xs uppercase tracking-wide text-ink-3">
            {expand && <th className="w-10 py-2 pl-3 pr-1" />}
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
            const child = expand?.(row, { isCommitted });
            const blockedReason = isCommitted ? null : (commitBlockedReason?.(row) ?? null);
            // Neither field here blocks the commit — a row can need review AND
            // still be committable — so this is computed independently of
            // `blockedReason`, and withheld once committed for the same reason
            // `blockedReason` is: the decision it informs is already made.
            const notice = isCommitted ? undefined : rowNotice?.(row);
            const isExpanded = rowId != null && expanded.has(rowId);

            return (
              <Fragment key={rowId ?? i}>
                <tr className="border-b border-hair last:border-0">
                  {expand && (
                    <td className="py-2 pl-3 pr-1 align-top">
                      {child && rowId && (
                        // A bare chevron in tertiary ink read as decoration —
                        // advisors missed that a row HAD positions to open. The
                        // affordance is the hairline box, not a heavier stroke:
                        // it borrows `.btn-ghost`'s hover (border and fill move
                        // to accent) so it reads as the control it is, while the
                        // icon itself stays the design system's 1.5-weight
                        // outline. `bg-card-2` is what makes it visible at rest.
                        <button
                          type="button"
                          onClick={() => toggleExpanded(rowId)}
                          aria-expanded={isExpanded}
                          aria-label={expandLabel?.(row) ?? "Show details"}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-hair bg-card-2 text-ink-2 transition-colors hover:border-accent hover:bg-accent-wash hover:text-accent"
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
                      const display = col.render
                        ? col.render(row, { isCommitted })
                        : formatValue(col.kind, rowValue(row, col.key));
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
                    {(notice?.needsReview || notice?.action) && (
                      <div className="mb-1 flex items-center justify-end gap-1.5">
                        {notice.needsReview && (
                          // Color is never the only signal (ui-ux-pro-max
                          // `color-not-only`) — the label carries the meaning,
                          // the warn tone is the accent. Same pill shape as
                          // `AssumedChip`, so a "this needs a look" marker
                          // reads consistently wherever it shows up.
                          <span
                            data-testid="needs-review"
                            title="Confidence is below the review threshold — check this value before committing."
                            className="inline-flex items-center gap-1 rounded border border-warn/30 bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn"
                          >
                            Needs review
                          </span>
                        )}
                        {notice.action && (
                          <span className="text-xs font-normal text-ink-3">
                            {notice.action}
                          </span>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => commit(rowId)}
                      disabled={isCommitted || isPending || disableCommit || !!blockedReason}
                      // `.btn-ghost`'s hover contract (border + text to accent,
                      // 6% accent wash) plus `.btn-primary`'s 1px lift, so the
                      // control announces itself on hover instead of sitting
                      // there as a hairline rectangle. Every hover rule is
                      // `enabled:`-scoped — CSS :hover still matches a disabled
                      // button, so an already-Committed row would otherwise
                      // light up and lift for a click that does nothing. The
                      // lift is `motion-safe:` per the design system's motion rule.
                      className="rounded border border-hair px-2.5 py-1 text-xs font-medium text-accent transition-[color,background-color,border-color,transform] duration-150 enabled:cursor-pointer enabled:hover:border-accent enabled:hover:bg-accent-wash enabled:hover:text-accent-ink motion-safe:enabled:hover:-translate-y-px disabled:cursor-default disabled:text-ink-4 disabled:opacity-60"
                    >
                      {isCommitted ? "Committed" : isPending ? "Committing…" : "Commit"}
                    </button>
                    {blockedReason && (
                      <div className="mt-1 text-xs font-normal normal-case text-ink-3">
                        {blockedReason}
                      </div>
                    )}
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
        {totals && (
          // Hierarchy comes from weight and a stronger hairline, never from
          // color: the accent is reserved for action, and coloring a figure
          // with it to make it "pop" is a brand violation.
          <tfoot>
            <tr className="border-t border-hair-2 font-semibold text-ink">
              {expand && <td className="py-2 pl-3 pr-1" />}
              {columns.map((col, i) => {
                const total = totals.get(col.key);
                if (total) {
                  return (
                    <td
                      key={col.key}
                      // Through `alignFor`, not a hardcoded `text-right`: it is
                      // the one place a column's `align` override is honored,
                      // and the header and body cells both already go through
                      // it. A second copy here would silently disagree with the
                      // column it sits under.
                      className={`tabular px-3 py-2 ${alignFor(col) === "right" ? "text-right" : "text-left"}`}
                    >
                      {formatValue(col.kind, total.sum)}
                    </td>
                  );
                }
                // Column 0 by the same convention `label` above relies on —
                // every entity's spec puts name/label first. A spec that
                // totalled its first column would already have broken `label`,
                // so hunting for "the first column that isn't a total" was
                // defending a state this file treats as impossible elsewhere.
                if (i === 0) {
                  return (
                    <th
                      key={col.key}
                      scope="row"
                      // `whitespace-nowrap` because the identity column is
                      // sized for names, not for this label — "31 accounts"
                      // otherwise breaks after the figure.
                      className="whitespace-nowrap px-3 py-2 text-left font-semibold"
                    >
                      <span className="tabular">{rows.length.toLocaleString("en-US")}</span>{" "}
                      {rows.length === 1 ? totalsNoun.one : totalsNoun.many}
                    </th>
                  );
                }
                return <td key={col.key} className="px-3 py-2" />;
              })}
              <td className="px-3 py-2" />
            </tr>
            {/*
             * The gap gets its own full-width row rather than a note tucked
             * under the figure: inside a money column it wrapped to three
             * lines ("excludes 1 / without a / value"), and a figure the
             * advisor is reconciling should not sit above a stack of broken
             * text. With the width it can say what it MEANS — a total under 25
             * rows reads as covering all 25 unless it says otherwise. Text,
             * not a color or an icon alone (`color-not-only`).
             */}
            {shortfalls.length > 0 && (
              <tr className="border-t border-hair">
                <td
                  // `columns.length + 2` matches the expanded-child row above:
                  // the leading disclosure cell plus the trailing action cell.
                  colSpan={columns.length + 2}
                  className="px-3 pb-2 pt-1.5 text-xs font-normal text-ink-3"
                >
                  {shortfalls.map((s) => (
                    <div key={s.header}>
                      {s.header} excludes <span className="tabular">{s.missing}</span>{" "}
                      {s.missing === 1 ? totalsNoun.one : totalsNoun.many} without a figure.
                    </div>
                  ))}
                </td>
              </tr>
            )}
          </tfoot>
        )}
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
