"use client";
// src/components/fact-finder/removed-tray.tsx
// The Removed tray at the bottom of a page: rows the advisor removed or merged,
// and rows a reader left out (like a statement's total line). Restore puts a
// row back where it was.
import { Card } from "@/components/card";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { ClientOp } from "@/lib/fact-finder/ops";
import type { FFSection } from "@/lib/fact-finder/schema";
import { rowLabel } from "@/lib/fact-finder/state";
import type { FFRemoved } from "@/lib/fact-finder/types";

const HEADING_ID = "fact-finder-removed";

export interface RemovedTrayProps {
  /** This page's tray entries, each with its section. */
  entries: { entry: FFRemoved; section: FFSection }[];
  onApply: (ops: ClientOp[]) => boolean;
}

export function RemovedTray({ entries, onApply }: RemovedTrayProps) {
  return (
    <Card aria-labelledby={HEADING_ID}>
      <div className="flex items-center gap-1.5 border-b border-hair px-[var(--pad-card)] py-3">
        <h3 id={HEADING_ID} className="text-sm font-semibold text-ink-2">
          Removed
        </h3>
        <span className="tabular text-xs text-ink-3">{entries.length}</span>
        <FieldTooltip
          text="Rows taken out of the fact finder wait here. Reading the documents again won't bring them back — Restore does."
          side="bottom"
        />
      </div>
      <ul className="divide-y divide-hair">
        {entries.map(({ entry, section }) => {
          const label = rowLabel(section, entry.row);
          return (
            <li key={entry.row.id} className="flex items-center gap-3 px-[var(--pad-card)] py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{label}</p>
                <p className="truncate text-xs text-ink-3">
                  {section.label} · {entry.reason}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Restore ${label}`}
                onClick={() => onApply([{ op: "restoreRow", rowId: entry.row.id }])}
                className="shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
              >
                Restore
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
