// src/components/fact-finder/worksheet-pane.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { cellText, rowInPlan, tableMarkdown } from "@/lib/fact-finder/worksheet/render";
import type { WsRow, WsTable } from "@/lib/fact-finder/worksheet/types";
import type { FactFinderState } from "@/lib/fact-finder/types";
import { GHOST_BUTTON } from "./button-styles";

export interface WorksheetPaneProps {
  state: FactFinderState;
  fileName(fileId: string): string | undefined;
  /** Ask the chat to match a table (or, with no id, every table) to the plan. Absent = read-only. */
  onMatch?: (tableId?: string) => void;
  /** A reply or read is in flight: the Match buttons are disabled. */
  busy: boolean;
}

const COPIED_MS = 2000;
// Money, number or percent as rendered: "$12,500", "1,234.5", "4.5%", "(300)", "-12".
const FIGURE = /^[-(]*-?\$?\d[\d,]*(\.\d+)?%?\)?$/;

function CopyButton({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function copy() {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }
  return (
    <button type="button" onClick={copy} className={GHOST_BUTTON}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function SourceChip({ row, fileName }: { row: WsRow; fileName: WorksheetPaneProps["fileName"] }) {
  const name = row.source ? fileName(row.source.fileId) : undefined;
  if (!row.source || !name) return null;
  return (
    <span className="ml-2 inline-block rounded border border-hair px-1.5 py-0.5 text-[11px] text-ink-3">
      {row.source.page ? `${name} p.${row.source.page}` : name}
    </span>
  );
}

function TableCard({ state, table, fileName, onMatch, busy }: WorksheetPaneProps & { table: WsTable }) {
  const texts = table.rows.map((row) => table.columns.map((c) => cellText(state, row, c)));
  // A column right-aligns when every filled cell is a figure.
  const figures = table.columns.map((_, i) => {
    const filled = texts.map((r) => r[i].text).filter((t) => t !== "");
    return filled.length > 0 && filled.every((t) => FIGURE.test(t));
  });
  const align = (i: number) => (figures[i] ? "text-right tabular" : "text-left");

  return (
    <section className="rounded-[var(--radius-sm)] border border-hair bg-card">
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{table.title}</h3>
          {table.note && <p className="mt-0.5 text-xs text-ink-3">{table.note}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <CopyButton markdown={tableMarkdown(state, table)} />
          {onMatch && (
            <button type="button" disabled={busy} onClick={() => onMatch(table.id)} className={`${GHOST_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}>
              Match to plan
            </button>
          )}
        </div>
      </header>
      <div className="max-h-96 overflow-auto border-t border-hair">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={c.id} scope="col" className={`sticky top-0 whitespace-nowrap border-b border-hair bg-card-2 px-3 py-2 text-xs font-medium text-ink-2 ${align(i)}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={row.id} className="border-b border-hair last:border-b-0">
                {table.columns.map((c, i) => {
                  const cell = texts[r][i];
                  return (
                    <td key={c.id} className={`px-3 py-2 text-ink ${align(i)}`}>
                      {cell.check && <span role="img" aria-label="Check this value" title="Check this value" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warn align-middle" />}
                      {cell.text}
                      {i === 0 && (
                        <>
                          {rowInPlan(state, row) && (
                            <span className="ml-2 rounded border border-hair-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">In plan</span>
                          )}
                          <SourceChip row={row} fileName={fileName} />
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WorksheetPane(props: WorksheetPaneProps) {
  const { state, onMatch, busy } = props;
  const { tables } = state.worksheet;
  if (tables.length === 0) {
    return <p className="p-6 text-sm text-ink-3">Upload documents or ask for a table — the tables the AI builds show up here.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {onMatch && tables.length > 1 && (
        <div>
          <button type="button" disabled={busy} onClick={() => onMatch()} className={`${GHOST_BUTTON} disabled:cursor-not-allowed disabled:opacity-50`}>
            Match all to plan
          </button>
        </div>
      )}
      {tables.map((table) => (
        <TableCard key={table.id} {...props} table={table} />
      ))}
    </div>
  );
}
