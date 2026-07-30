"use client";

import type { Annotated } from "@/lib/imports/types";
import type { ExtractedSavings } from "@/lib/extraction/types";
import SourceBadge from "./source-badge";

const OWNER_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
];

export interface ReviewStepSavingsProps {
  rows: Annotated<ExtractedSavings>[];
  onChange: (rows: Annotated<ExtractedSavings>[]) => void;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-accent focus:outline-none";
// Read-only cells (Destination, Amount) — neither is free-text editable here:
// Destination resolves to an account by name at commit, and Amount is a
// derived label (percent / flat / match), not a raw value to type over.
const DISPLAY_CLASS =
  "w-full truncate rounded border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-sm text-gray-300";

/** Renders the amount cell: percent-of-salary, flat dollars, or a match. */
export function formatSavingsAmount(row: ExtractedSavings): string {
  if (row.annualPercent != null) {
    return `${(row.annualPercent * 100).toFixed(row.annualPercent * 100 % 1 === 0 ? 0 : 1)}% of salary`;
  }
  if (row.annualAmount != null) {
    return `$${row.annualAmount.toLocaleString("en-US")}/yr`;
  }
  if (row.employerMatchPct != null && row.employerMatchCap != null) {
    return `Employer match (${(row.employerMatchPct * 100).toFixed(0)}% on ${(row.employerMatchCap * 100).toFixed(1)}% of salary)`;
  }
  return "-";
}

export default function ReviewStepSavings({ rows, onChange }: ReviewStepSavingsProps) {
  const updateField = (index: number, field: keyof ExtractedSavings, value: unknown) => {
    const updated = rows.map((r, i) => (i === index ? { ...r, [field]: value } : r));
    onChange(updated);
  };

  const addRow = () => {
    onChange([
      ...rows,
      { name: "", destinationAccountName: "", owner: "client", match: { kind: "new" } },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-100">
          Savings ({rows.length} found)
        </h3>
        <button
          onClick={addRow}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-accent hover:bg-gray-700"
        >
          + Add Row
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">
          No savings or contributions were found in these documents.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
              <div className="grid grid-cols-5 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Name</label>
                  <input
                    value={row.name}
                    onChange={(e) => updateField(i, "name", e.target.value)}
                    className={row.name ? INPUT_CLASS : EMPTY_CLASS}
                    placeholder="Contribution name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Destination</label>
                  <div className={DISPLAY_CLASS} title={row.destinationAccountName}>
                    {row.destinationAccountName || "-"}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Owner</label>
                  <select
                    value={row.owner ?? "client"}
                    onChange={(e) => updateField(i, "owner", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {OWNER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-300">Amount</label>
                  <div className={DISPLAY_CLASS}>{formatSavingsAmount(row)}</div>
                </div>
                <div className="flex items-end gap-2">
                  <SourceBadge row={row} className="pb-1" />
                  <button
                    onClick={() => removeRow(i)}
                    className="pb-1 text-white hover:text-white"
                    title="Remove"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}
