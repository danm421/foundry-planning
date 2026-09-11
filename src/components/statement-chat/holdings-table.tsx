"use client";

import { useState } from "react";
import type { ExtractedAccount, ExtractedHolding } from "@/lib/extraction/types";
import { livingHoldings } from "@/lib/imports/living-rows";
import { isEditableHoldingField, isValidHoldingValue } from "@/lib/statement-chat/holding-fields";
import { formatValue, type ColumnKind } from "./entity-table";
import { HOLDING_COLUMNS } from "./holdings-columns";

export interface HoldingsTableProps {
  rowId: string;
  row: Pick<ExtractedAccount, "value" | "holdings">;
  /** The account is already committed, so its positions are in the plan and
   *  this surface can no longer change them. Renders every figure as plain
   *  text — no editors, no Drop — matching what `EntityTable` does to the
   *  account's own cells and what the chat tools do to the same request. */
  readOnly?: boolean;
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
export function HoldingsTable({
  rowId,
  row,
  readOnly = false,
  onEditHolding,
  onDropHolding,
}: HoldingsTableProps) {
  const living = livingHoldings(row);
  const [editing, setEditing] = useState<{ holdingId: string; key: string } | null>(null);

  if (living.length === 0) return null;

  const commitEdit = (holdingId: string, field: string, raw: string) => {
    setEditing(null);
    if (!isEditableHoldingField(field)) return;
    // R20: `Number("")` is `0`, and `Number.isFinite(0)` is `true` — so a
    // blank numeric cell would otherwise sail past `isValidHoldingValue`
    // below and silently write `0`. `<input type="number">`'s own value-
    // sanitization sets `.value` to `""` for ANY unparseable entry (not just
    // an explicit clear), so this is the common case for a typo, not an edge
    // case. Rejected here, before coercion, so it never reaches `Number()`.
    // Clearing a TEXT field is different and deliberate: it writes `""`,
    // which `cellText` renders as `—` — a real clear, not a typo, so it is
    // NOT rejected here.
    if (!TEXT_FIELDS.has(field) && raw.trim() === "") return;
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
          {!readOnly && <th className="px-2 py-1" />}
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
                  {readOnly ? (
                    cellText(col.kind, h[col.key as keyof ExtractedHolding])
                  ) : holdingId && editing?.holdingId === holdingId && editing.key === col.key ? (
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
                      // R21: appended, never a replacement — an `aria-label`
                      // OVERRIDES a button's text content as its accessible
                      // name, so a label with no value in it would make every
                      // figure in this table unreadable to a screen reader,
                      // on a table whose only purpose is reviewing figures
                      // before they reach a client's plan. `entity-table.tsx`
                      // avoids this by giving its own edit button NO
                      // `aria-label` at all, letting the displayed value BE
                      // the name; this column instead needs the field/ticker
                      // context the brief's tests query by, so the value is
                      // suffixed onto it rather than dropped.
                      aria-label={`Edit ${col.header.toLowerCase()} for ${holdingLabel(h)}: ${formatValue(col.kind, h[col.key as keyof ExtractedHolding])}`}
                      className="text-ink hover:text-accent-ink disabled:cursor-default"
                    >
                      {cellText(col.kind, h[col.key as keyof ExtractedHolding])}
                    </button>
                  )}
                </td>
              ))}
              {!readOnly && (
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
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function cellText(kind: ColumnKind, value: unknown) {
  // Wrapped in `tabular` only on the exact same condition `formatValue`
  // used to produce a numerically-formatted string — never inferred from
  // `kind` alone, or a money/number COLUMN holding a stray non-numeric value
  // (defensive; shouldn't happen) would wrap plain text in a figure font.
  if ((kind === "money" || kind === "number" || kind === "price") && typeof value === "number") {
    return <span className="tabular">{formatValue(kind, value)}</span>;
  }
  return formatValue(kind, value);
}
