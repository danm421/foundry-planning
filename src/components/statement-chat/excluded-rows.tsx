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
  onInclude: (row: Row) => void;
}

/**
 * Prose for one excluded row. Prefers the structured `decision` (C2) so the
 * copy can never drift from what the merge actually recorded; `reason` is
 * the fallback for a producer with no decision behind it (e.g. an advisor's
 * own "drop row", Task 11).
 */
function excludedReason<Row>(x: ExcludedRow<Row>): string {
  if (x.decision?.kind === "rollup-excluded") {
    // C3/Ruling 32 (mirrored from narrate.ts's rollupCaveat): `coversCount`
    // names how many sibling rows are already listed — not a claim the
    // total's arithmetic reconciles with them.
    return `a total covering ${x.decision.coversCount} accounts already listed`;
  }
  return x.reason;
}

/**
 * Excluded (and superseded) rows, greyed below the working set with their
 * reason and a restore toggle. Stays generic — its copy comes from the
 * `MergeDecision`, never from anything account-shaped (controller
 * amendment, Task 10).
 */
export default function ExcludedRows<Row>({ excluded, label, onInclude }: ExcludedRowsProps<Row>) {
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
              <span className="text-ink-3">{label(x.row)}</span> — {excludedReason(x)}
            </span>
            <button
              type="button"
              onClick={() => onInclude(x.row)}
              className="shrink-0 rounded border border-hair px-2 py-1 text-xs text-accent hover:border-hair-2"
            >
              Include anyway
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
