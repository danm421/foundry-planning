"use client";

import type { Annotated } from "@/lib/imports/types";
import type { ExtractedSavings } from "@/lib/extraction/types";
import { resolveAccountName } from "@/lib/imports/account-name-match";
import SourceBadge from "./source-badge";

const OWNER_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "spouse", label: "Spouse" },
  { value: "joint", label: "Joint" },
];

export interface ReviewStepSavingsProps {
  rows: Annotated<ExtractedSavings>[];
  /**
   * Names a contribution can be attached to — the client's existing accounts
   * plus the accounts this import will create. `commitSavings` resolves the
   * destination BY NAME against accounts committed before it, so a name from
   * either source is valid.
   */
  accountOptions: string[];
  onChange: (rows: Annotated<ExtractedSavings>[]) => void;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const EMPTY_CLASS =
  "w-full rounded border border-amber-600/50 bg-amber-900/20 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-300 focus:border-accent focus:outline-none";
// Amount stays read-only — it is a derived label (percent / flat / match), not
// a raw value to type over. Destination IS editable (a picker): it resolves to
// an account by name at commit, and a row whose name matches nothing is
// silently skipped there, so the advisor needs a way to point it somewhere real.
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
  // Checked after the pct/cap formula because the engine prefers that formula
  // when a document somehow supplied both; a pay stub only ever sets this one.
  if (row.employerMatchAmount != null) {
    return `Employer $${row.employerMatchAmount.toLocaleString("en-US")}/yr`;
  }
  return "-";
}

/**
 * Destination picker for one contribution row.
 *
 * Three cases, and the middle one is why this isn't a plain <select>:
 *  - the value matches an option exactly — ordinary select behaviour;
 *  - the value resolves only after normalization ("401k fidelity" →
 *    "401(k) - Fidelity"), so it is a valid destination but matches no <option>
 *    and would render as nothing selected. It gets its own option showing what
 *    it will attach to.
 *  - the value matches nothing — the usual pay-stub case, since the extractor
 *    proposes "<Employer> 401(k)" and no such account exists yet. Commit skips
 *    these, so the row is flagged amber and says so rather than looking fine.
 */
function DestinationCell({
  value,
  accountOptions,
  onChange,
}: {
  value: string;
  accountOptions: string[];
  onChange: (next: string) => void;
}) {
  const resolved = resolveAccountName(value, accountOptions);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={resolved ? SELECT_CLASS : EMPTY_CLASS}
      title={value}
    >
      <option value="">— Select account —</option>
      {value && resolved !== value ? (
        <option value={value}>
          {resolved ? `${value} → ${resolved}` : `${value} (no match — will be skipped)`}
        </option>
      ) : null}
      {accountOptions.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  );
}

export default function ReviewStepSavings({
  rows,
  accountOptions,
  onChange,
}: ReviewStepSavingsProps) {
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
                  <DestinationCell
                    value={row.destinationAccountName}
                    accountOptions={accountOptions}
                    onChange={(v) => updateField(i, "destinationAccountName", v)}
                  />
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
