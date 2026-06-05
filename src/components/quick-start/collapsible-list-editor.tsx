"use client";
import { useState, type ReactNode } from "react";

export interface ListColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface CollapsibleListEditorProps<Row extends { _id: number }> {
  rows: Row[];
  columns: ListColumn[];
  /** One cell per column, in order. */
  renderSummary: (row: Row) => ReactNode[];
  /** The expanded editor body; `update` patches this row. */
  renderEditor: (row: Row, update: (patch: Partial<Row>) => void) => ReactNode;
  update: (id: number, patch: Partial<Row>) => void;
  onChange: (rows: Row[]) => void;
  newRow: () => Row;
  onRemove: (row: Row) => void;
  isPinned?: (row: Row) => boolean;
  isEmpty?: (row: Row) => boolean;
  /** Accessible name for the collapsed row button; defaults to `Row <id>`. */
  rowLabel?: (row: Row) => string;
  addLabel: string;
}

export function CollapsibleListEditor<Row extends { _id: number }>(
  props: CollapsibleListEditorProps<Row>,
) {
  const {
    rows, columns, renderSummary, renderEditor, update, onChange, newRow,
    onRemove, isPinned, isEmpty, rowLabel, addLabel,
  } = props;
  const [openId, setOpenId] = useState<number | null>(null);

  // Pinned rows (e.g. Social Security) sort to the top; sort() is stable in modern JS.
  const ordered = [...rows].sort(
    (a, b) => (isPinned?.(b) ? 1 : 0) - (isPinned?.(a) ? 1 : 0),
  );

  const add = () => {
    const r = newRow();
    onChange([...rows, r]);
    setOpenId(r._id);
  };

  const gridCols = `repeat(${columns.length}, minmax(0, 1fr)) auto`;

  return (
    <div className="space-y-2">
      <div
        className="grid items-center gap-3 px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4"
        style={{ gridTemplateColumns: gridCols }}
      >
        {columns.map((c) => (
          <div key={c.key} className={c.align === "right" ? "text-right" : ""}>
            {c.label}
          </div>
        ))}
        <div aria-hidden />
      </div>

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-hair">
        {ordered.map((row, i) => {
          const open = openId === row._id;
          const pinned = !!isPinned?.(row);
          const empty = !!isEmpty?.(row);
          return (
            <div key={row._id} className={i > 0 ? "border-t border-hair" : ""}>
              {open ? (
                <div className="space-y-3 bg-card-2/40 p-4">
                  {renderEditor(row, (patch) => update(row._id, patch))}
                  <div className="flex items-center justify-between pt-1">
                    {!pinned ? (
                      <button
                        type="button"
                        onClick={() => {
                          onRemove(row);
                          setOpenId(null);
                        }}
                        className="text-[12px] text-ink-3 transition-colors hover:text-crit"
                      >
                        Remove
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-accent"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={rowLabel ? rowLabel(row) : `Row ${row._id}`}
                  onClick={() => setOpenId(row._id)}
                  className={
                    "grid w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-card-hover " +
                    (empty ? "text-ink-4" : "text-ink-2")
                  }
                  style={{ gridTemplateColumns: gridCols }}
                >
                  {renderSummary(row).map((cell, idx) => (
                    <div
                      key={columns[idx]?.key ?? idx}
                      className={
                        (columns[idx]?.align === "right" ? "text-right tabular " : "") +
                        "min-w-0 truncate"
                      }
                    >
                      {cell}
                    </div>
                  ))}
                  <span className="text-ink-4" aria-hidden>⌄</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="rounded-[var(--radius-sm)] border border-dashed border-hair px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
      >
        {addLabel}
      </button>
    </div>
  );
}
