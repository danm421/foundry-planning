"use client";

import { useEffect, useState } from "react";
import InsurancePolicyCsvUpload from "./insurance-policy-csv-upload";

interface InsurancePolicyCashValueGridProps {
  rows: { year: number; cashValue: number }[];
  onChange: (rows: { year: number; cashValue: number }[]) => void;
}

interface GridRow {
  _id: string;
  year: number;
  cashValue: number;
}

// Coerce a text input value → integer. Empty string becomes 0.
function toInt(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// Coerce a text input value → number. Empty string becomes 0.
function toNum(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function makeId(): string {
  // `crypto.randomUUID()` is available in modern browsers and React 19's
  // client runtime; fall back to a Math-based id for any exotic environment.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function stripIds(rows: GridRow[]): { year: number; cashValue: number }[] {
  return rows.map(({ year, cashValue }) => ({ year, cashValue }));
}

function isSameSchedule(
  a: { year: number; cashValue: number }[],
  b: GridRow[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].year !== b[i].year || a[i].cashValue !== b[i].cashValue) {
      return false;
    }
  }
  return true;
}

export default function InsurancePolicyCashValueGrid({
  rows,
  onChange,
}: InsurancePolicyCashValueGridProps) {
  // Internal-state implementation: the grid keeps its own `GridRow[]` with
  // stable client-side `_id`s so React can key rows by id (not index). This
  // keeps input DOM/focus attached to the correct row after a middle-row
  // delete. We reseed ids from `props.rows` only when the external value
  // actually differs from our current view (e.g. CSV upload, initial mount),
  // otherwise our self-initiated changes would re-mint ids on every render.
  const [gridRows, setGridRows] = useState<GridRow[]>(() =>
    rows.map((r) => ({ ...r, _id: makeId() })),
  );

  useEffect(() => {
    if (!isSameSchedule(rows, gridRows)) {
      setGridRows(rows.map((r) => ({ ...r, _id: makeId() })));
    }
    // gridRows intentionally not a dep: we only want to sync when the
    // *external* prop changes. Including gridRows would loop after every
    // self-initiated update. The equality check guards against false
    // positives from parent re-renders that pass identical row data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function commit(next: GridRow[]) {
    setGridRows(next);
    onChange(stripIds(next));
  }

  function updateRow(
    index: number,
    patch: Partial<{ year: number; cashValue: number }>,
  ) {
    commit(gridRows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    commit(gridRows.filter((_, i) => i !== index));
  }

  function addRow() {
    commit([...gridRows, { _id: makeId(), year: 0, cashValue: 0 }]);
  }

  function handleCsvParsed(parsed: { year: number; cashValue: number }[]) {
    commit(parsed.map((r) => ({ ...r, _id: makeId() })));
  }

  return (
    <div>
      <InsurancePolicyCsvUpload onParsed={handleCsvParsed} />

      {gridRows.length === 0 ? (
        <p className="mb-3 text-xs text-gray-400">
          No schedule rows yet. Add rows manually or upload a CSV.
        </p>
      ) : (
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-300">
              <th className="py-1 pr-2 font-medium">Year</th>
              <th className="py-1 pr-2 text-right font-medium">Cash value</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {gridRows.map((row, i) => (
              <tr key={row._id} className="border-t border-gray-800">
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    min="1900"
                    max="2200"
                    step="1"
                    value={row.year}
                    onChange={(e) =>
                      updateRow(i, { year: toInt(e.target.value) })
                    }
                    className="w-24 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="py-1 pr-2 text-right">
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={row.cashValue}
                    onChange={(e) =>
                      updateRow(i, { cashValue: toNum(e.target.value) })
                    }
                    className="w-32 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label={`Remove year ${row.year}`}
                    className="px-2 text-gray-400 hover:text-red-400"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        type="button"
        onClick={addRow}
        className="text-xs text-blue-400 hover:text-blue-300"
      >
        + Add row
      </button>
    </div>
  );
}
