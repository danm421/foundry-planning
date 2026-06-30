"use client";

import React from "react";

export interface YearTableColumn<Row> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: Row) => React.ReactNode;
  tone?: (row: Row) => "default" | "crit";
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
  const maxH =
    maxHeight == null
      ? undefined
      : typeof maxHeight === "number"
        ? `${maxHeight}px`
        : maxHeight;
  return (
    <div
      className={maxHeight == null ? "overflow-x-auto" : "overflow-auto"}
      style={maxH ? { maxHeight: maxH } : undefined}
    >
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        {caption && (
          <caption className="sr-only">{caption}</caption>
        )}
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={
                  "max-w-[9rem] whitespace-normal border-b-2 border-hair bg-card px-3 py-3.5 text-[13px] font-semibold uppercase leading-tight tracking-wider text-ink-2 first:pl-4 last:pr-4 " +
                  (col.align === "right" ? "text-right" : "text-left")
                }
              >
                <span className="inline-block whitespace-normal break-words leading-tight">
                  {col.header}
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
                      (isRight ? "text-right tabular " : "") +
                      (isCrit
                        ? "text-[color:var(--color-crit)]"
                        : "text-ink")
                    }
                  >
                    {col.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
