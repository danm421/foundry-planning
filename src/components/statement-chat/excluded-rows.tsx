"use client";

import type { ReactNode } from "react";
import type { MergeDecision } from "@/lib/imports/assemble/decisions";

/**
 * The one `excludedRows` shape used everywhere on this plan (Ruling 3 / C2),
 * generic over the entity's row type rather than pinned to
 * `Annotated<ExtractedAccount>` — Task 4's rollup detector always sets
 * `decision`; an advisor-initiated drop (Task 11) has none, so it stays
 * optional. Deliberately wide: do not narrow it.
 */
export interface ExcludedRow<Row> {
  row: Row;
  reason: string;
  decision?: MergeDecision;
}

export interface ExcludedRowsProps<Row> {
  excluded: ExcludedRow<Row>[];
  /** Identity label for a row — reuses whatever the caller renders as its
   *  own first (name) column, so this stays generic over the entity shape. */
  label: (row: Row) => ReactNode;
  /**
   * Lifts a row into the working set. Optional (Task 10 review, CRITICAL):
   * when absent, "Include anyway" renders disabled rather than silently
   * doing something other than what its label says (it previously posted a
   * commit — a printed total, restored "anyway", would double-count the
   * household's net worth).
   */
  onRestore?: (row: Row) => void;
}

/**
 * Excluded (and superseded) rows, greyed below the working set with their
 * reason and a restore toggle. Stays generic — `reason` is rendered as-is,
 * never reformatted from `decision` here (Task 10 review, Important 4/5):
 * every producer (`detectRollups`, an advisor's own drop) already populates
 * `reason` with entity-appropriate prose, and rebuilding a sentence from
 * `decision` fields in this file was itself an amendment violation — the
 * word "accounts" doesn't belong in a component Phase 2 reuses for
 * annuities and policies.
 */
export default function ExcludedRows<Row>({ excluded, label, onRestore }: ExcludedRowsProps<Row>) {
  if (excluded.length === 0) return null;

  return (
    <div className="border-t border-hair">
      <h3 className="px-3 pt-3 text-xs font-medium uppercase tracking-wide text-ink-4">Not included</h3>
      <ul className="divide-y divide-hair">
        {excluded.map((x, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-ink-4 opacity-60"
          >
            <span>
              <span className="text-ink-3">{label(x.row)}</span> — {x.reason}
            </span>
            <button
              type="button"
              onClick={() => onRestore?.(x.row)}
              disabled={!onRestore}
              className="shrink-0 rounded border border-hair px-2 py-1 text-xs text-accent hover:border-hair-2 disabled:cursor-default disabled:text-ink-4 disabled:opacity-60"
            >
              Include anyway
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
