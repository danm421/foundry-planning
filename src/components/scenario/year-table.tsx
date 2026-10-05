"use client";

import React, { useState } from "react";
import type { CellDrillProps } from "@/lib/cell-drill/types";
import { CellDrillDownModal } from "@/components/cell-drill-down-modal";
import { TaxDetailTooltip } from "@/components/cashflow/tax-detail-tooltip";

export interface YearTableColumn<Row> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: Row) => React.ReactNode;
  tone?: (row: Row) => "default" | "crit";
  /** Adjacent columns sharing a group get one label above their headers, and a
   *  divider where the group starts and ends. */
  group?: string;
  /** How the column is derived — revealed from an info icon in the header. */
  tooltip?: string;
  /** When set and returning non-null for a row, the cell renders as a button
   *  that opens the cell drill-down modal with the returned breakdown. */
  drill?: (row: Row) => CellDrillProps | null;
}

export interface AnalysisYearTableProps<Row> {
  rows: Row[];
  columns: YearTableColumn<Row>[];
  caption?: string;
  /** When set, this div becomes the sole (both-axis) scroll container and is
   *  height-capped, so the sticky `thead` locks on vertical scroll. Without it,
   *  a vertical-scrolling ancestor would scroll the header out of view because
   *  `position: sticky` resolves against the nearest scroll container. */
  maxHeight?: number | string;
}

export function AnalysisYearTable<Row>({
  rows,
  columns,
  caption,
  maxHeight,
}: AnalysisYearTableProps<Row>) {
  const [drill, setDrill] = useState<CellDrillProps | null>(null);
  // A divider runs down the left edge of every column whose group differs
  // from its neighbor's.
  const startsGroup = (i: number) => i > 0 && columns[i].group !== columns[i - 1].group;
  const groupRuns: { group?: string; start: number; span: number }[] = [];
  if (columns.some((c) => c.group)) {
    columns.forEach((col, i) => {
      const last = groupRuns.at(-1);
      if (last && !startsGroup(i)) last.span += 1;
      else groupRuns.push({ group: col.group, start: i, span: 1 });
    });
  }
  const maxH =
    maxHeight == null
      ? undefined
      : typeof maxHeight === "number"
        ? `${maxHeight}px`
        : maxHeight;
  return (
    <>
    <div
      className={maxHeight == null ? "overflow-x-auto" : "overflow-auto"}
      style={maxH ? { maxHeight: maxH } : undefined}
    >
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        {caption && (
          <caption className="sr-only">{caption}</caption>
        )}
        <thead className="sticky top-0 z-20 bg-card">
          {groupRuns.length > 0 && (
            <tr>
              {groupRuns.map((run) => (
                <th
                  key={run.start}
                  scope={run.group ? "colgroup" : undefined}
                  colSpan={run.span}
                  className={
                    "bg-card px-3 pb-1.5 pt-3 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-3 " +
                    (run.group ? "border-b border-hair " : "") +
                    (startsGroup(run.start) ? "border-l border-hair" : "")
                  }
                >
                  {run.group}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {columns.map((col, colIdx) => (
              <th
                key={col.key}
                scope="col"
                className={
                  "max-w-[9rem] whitespace-normal border-b-2 border-hair bg-card px-3 py-3.5 text-[13px] font-semibold uppercase leading-tight tracking-wider text-ink-2 first:pl-4 last:pr-4 " +
                  (startsGroup(colIdx) ? "border-l " : "") +
                  (col.align === "right" ? "text-right" : "text-left")
                }
              >
                <span className="inline-block whitespace-normal break-words leading-tight">
                  {col.header}
                  {col.tooltip ? (
                    // The header is uppercase; the explanation reads as a sentence.
                    <span className="ml-1 inline-flex align-middle normal-case tracking-normal">
                      <TaxDetailTooltip text={col.tooltip} iconLabel={`About ${col.header}`} />
                    </span>
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className="hover:[&>td]:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]"
            >
              {columns.map((col, colIdx) => {
                const isCrit = col.tone?.(row) === "crit";
                const isRight = col.align === "right";
                return (
                  <td
                    key={col.key}
                    className={
                      "whitespace-nowrap border-b border-hair bg-card px-3 py-2 " +
                      (colIdx === 0 ? "first:pl-4 " : "") +
                      (colIdx === columns.length - 1 ? "last:pr-4 " : "") +
                      (startsGroup(colIdx) ? "border-l " : "") +
                      (isRight ? "text-right tabular " : "") +
                      (isCrit
                        ? "text-[color:var(--color-crit)]"
                        : "text-ink")
                    }
                  >
                    {(() => {
                      const content = col.drill ? col.drill(row) : null;
                      if (!content) return col.render(row);
                      return (
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => setDrill(content)}
                          className="underline decoration-dotted decoration-ink-4 underline-offset-2 hover:text-accent hover:decoration-accent"
                        >
                          {col.render(row)}
                        </button>
                      );
                    })()}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {drill ? <CellDrillDownModal {...drill} onClose={() => setDrill(null)} /> : null}
    </>
  );
}
