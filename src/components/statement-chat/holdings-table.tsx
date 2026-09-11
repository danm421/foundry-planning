"use client";

import { useState } from "react";
import type { ExtractedAccount, ExtractedHolding } from "@/lib/extraction/types";
import { livingHoldings } from "@/lib/imports/living-rows";
import { isEditableHoldingField, isValidHoldingValue } from "@/lib/statement-chat/holding-fields";
import { HOLDING_COLUMNS } from "./holdings-columns";

export interface HoldingsTableProps {
  rowId: string;
  row: Pick<ExtractedAccount, "value" | "holdings">;
  onEditHolding: (rowId: string, holdingId: string, field: string, value: unknown) => void;
  onDropHolding: (rowId: string, holdingId: string) => void;
}

/** The label a position is known by in every control's accessible name. */
function holdingLabel(h: ExtractedHolding): string {
  return h.ticker ?? h.name ?? h.__holdingId ?? "position";
}

const TEXT_FIELDS: ReadonlySet<string> = new Set(["ticker", "name"]);

/**
 * The positions inside one account, rendered beneath it.
 *
 * A plain table rather than a nested `EntityTable`: `EntityTable`'s own
 * surface is commit-shaped (a Commit button per row, an excluded-rows
 * footer), and a position is never committed on its own — it commits with
 * its account. Task 6 adds per-cell editing and a drop action here directly.
 */
export function HoldingsTable({ rowId, row, onEditHolding, onDropHolding }: HoldingsTableProps) {
  const living = livingHoldings(row);
  const [editing, setEditing] = useState<{ holdingId: string; key: string } | null>(null);

  if (living.length === 0) return null;

  const commitEdit = (holdingId: string, field: string, raw: string) => {
    setEditing(null);
    if (!isEditableHoldingField(field)) return;
    // Coerced HERE, at the one boundary a string becomes a payload value. A
    // numeric field that reaches the payload as a string is STORED as one,
    // and the engine then concatenates instead of adding — `1 + "0.03"` is
    // `"10.03"`. An unparseable entry is dropped rather than written.
    const value = TEXT_FIELDS.has(field) ? raw : Number(raw);
    if (!isValidHoldingValue(field, value)) return;
    onEditHolding(rowId, holdingId, field, value);
  };

  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-ink-3">
          {HOLDING_COLUMNS.map((col) => (
            <th key={col.key} className="px-2 py-1 font-medium">
              {col.header}
            </th>
          ))}
          <th className="px-2 py-1" />
        </tr>
      </thead>
      <tbody>
        {living.map((h, i) => {
          // Narrowed to a local so the comparison below can prove `editing`
          // non-null when it matches: `h.__holdingId` is itself optional
          // (`ExtractedHolding.__holdingId?: string`), so comparing against
          // it directly can never rule out `undefined === undefined`, and
          // TypeScript won't narrow `editing` through that comparison (the
          // problem `entity-table.tsx` sidesteps by narrowing `rowId` first).
          const holdingId = h.__holdingId;
          return (
            <tr key={holdingId ?? i}>
              {HOLDING_COLUMNS.map((col) => (
                <td key={col.key} className="px-2 py-1">
                  {holdingId && editing?.holdingId === holdingId && editing.key === col.key ? (
                    <input
                      autoFocus
                      type={TEXT_FIELDS.has(col.key) ? "text" : "number"}
                      defaultValue={String(h[col.key as keyof ExtractedHolding] ?? "")}
                      aria-label={`${col.header} for ${holdingLabel(h)}`}
                      onBlur={(e) => commitEdit(holdingId, col.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        // Escape backs out without writing — the one way out
                        // of an editor opened by mistake (same rule as
                        // EntityTable).
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="w-20 rounded border border-hair bg-paper px-1 text-xs text-ink"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={!holdingId}
                      onClick={() => setEditing({ holdingId: holdingId!, key: col.key })}
                      aria-label={`Edit ${col.header.toLowerCase()} for ${holdingLabel(h)}`}
                      className="text-ink hover:text-accent-ink disabled:cursor-default"
                    >
                      {cellText(col.kind, h[col.key as keyof ExtractedHolding])}
                    </button>
                  )}
                </td>
              ))}
              <td className="px-2 py-1 text-right">
                <button
                  type="button"
                  disabled={!holdingId}
                  onClick={() => onDropHolding(rowId, holdingId!)}
                  aria-label={`Drop ${holdingLabel(h)}`}
                  className="text-ink-3 hover:text-crit disabled:cursor-default"
                >
                  Drop
                </button>
              </td>
            </tr>
          );
        })}
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
