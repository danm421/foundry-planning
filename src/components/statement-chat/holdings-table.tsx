"use client";

import type { ExtractedAccount, ExtractedHolding } from "@/lib/extraction/types";
import { livingHoldings } from "@/lib/imports/living-rows";
import { HOLDING_COLUMNS } from "./holdings-columns";

/**
 * The positions inside one account, rendered beneath it.
 *
 * A plain table rather than a nested `EntityTable`: `EntityTable`'s own
 * surface is commit-shaped (a Commit button per row, an excluded-rows
 * footer), and a position is never committed on its own — it commits with
 * its account. Task 6 adds per-cell editing here directly.
 */
export function HoldingsTable({
  row,
}: {
  row: Pick<ExtractedAccount, "value" | "holdings">;
}) {
  const living = livingHoldings(row);
  if (living.length === 0) return null;

  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-ink-3">
          {HOLDING_COLUMNS.map((col) => (
            <th key={col.key} className="px-2 py-1 font-medium">
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {living.map((h, i) => (
          <tr key={h.__holdingId ?? i}>
            {HOLDING_COLUMNS.map((col) => (
              <td key={col.key} className="px-2 py-1">
                {cellText(col.kind, h[col.key as keyof ExtractedHolding])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellText(kind: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (kind === "money" && typeof value === "number") {
    return <span className="tabular">${Math.round(value).toLocaleString("en-US")}</span>;
  }
  if (kind === "number" && typeof value === "number") {
    return <span className="tabular">{value.toLocaleString("en-US")}</span>;
  }
  return String(value);
}
