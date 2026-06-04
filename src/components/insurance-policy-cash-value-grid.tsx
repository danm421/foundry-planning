"use client";

import { type ChangeEvent, useEffect, useState } from "react";

export interface ScheduleRow {
  year: number;
  cashValue?: number;
  premiumAmount?: number;
  income?: number;
  deathBenefit?: number;
}

interface InsurancePolicyCashValueGridProps {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  /** Called after a CSV upload — instructs the parent to activate any modes
   *  that have at least one non-empty value in the uploaded data. */
  onCsvPasted?: (rows: ScheduleRow[]) => void;
}

interface GridRow extends ScheduleRow {
  _id: string;
}

// Coerce a text input value → integer. Empty string becomes 0.
function toInt(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// Coerce an optional numeric cell: "" → undefined, else a number.
function toOptNum(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function makeId(): string {
  // `crypto.randomUUID()` is available in modern browsers and React 19's
  // client runtime; fall back to a Math-based id for any exotic environment.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function stripIds(rows: GridRow[]): ScheduleRow[] {
  return rows.map(({ year, cashValue, premiumAmount, income, deathBenefit }) => ({
    year,
    cashValue,
    premiumAmount,
    income,
    deathBenefit,
  }));
}

function isSameSchedule(a: ScheduleRow[], b: GridRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].year !== b[i].year ||
      a[i].cashValue !== b[i].cashValue ||
      a[i].premiumAmount !== b[i].premiumAmount ||
      a[i].income !== b[i].income ||
      a[i].deathBenefit !== b[i].deathBenefit
    ) {
      return false;
    }
  }
  return true;
}

// Column order shared by the parser, the downloadable template, and the
// on-screen hint. Keep all three in sync.
export const SCHEDULE_CSV_HEADER = "Year,Premium,Income,Cash Value,Death Benefit";

/** A starter CSV (header + two example rows) for advisors to fill in and
 *  re-upload. Blank cells (e.g. Income) are left empty on purpose. */
export function buildScheduleCsvTemplate(): string {
  return (
    [SCHEDULE_CSV_HEADER, "2025,12000,,250000,500000", "2026,12000,,265000,510000"].join(
      "\n",
    ) + "\n"
  );
}

export function parseScheduleCsv(text: string): ScheduleRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const start = /year/i.test(lines[0]) ? 1 : 0; // tolerate header or not
  const rows: ScheduleRow[] = [];
  for (const line of lines.slice(start)) {
    const [year, premium, income, cashValue, deathBenefit] = line
      .split(",")
      .map((c) => c.trim());
    const y = Number(year);
    if (!Number.isFinite(y)) continue;
    const num = (v: string | undefined) => {
      if (v == null || v.trim() === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    rows.push({
      year: y,
      premiumAmount: num(premium),
      income: num(income),
      cashValue: num(cashValue),
      deathBenefit: num(deathBenefit),
    });
  }
  return rows.sort((a, b) => a.year - b.year);
}

export default function InsurancePolicyCashValueGrid({
  rows,
  onChange,
  onCsvPasted,
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
  const [csvError, setCsvError] = useState<string | null>(null);

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

  function updateRow(index: number, patch: Partial<ScheduleRow>) {
    commit(gridRows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    commit(gridRows.filter((_, i) => i !== index));
  }

  function addRow() {
    commit([...gridRows, { _id: makeId(), year: 0 }]);
  }

  async function handleUploadCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires onChange again.
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const parsed = parseScheduleCsv(text);
    if (parsed.length === 0) {
      setCsvError("No valid rows found. Use the template and try again.");
      return;
    }
    setCsvError(null);
    const next = parsed.map((r) => ({ ...r, _id: makeId() }));
    setGridRows(next);
    onChange(stripIds(next));
    onCsvPasted?.(parsed);
  }

  function downloadTemplate() {
    const blob = new Blob([buildScheduleCsvTemplate()], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cash-value-schedule-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* CSV upload / template section */}
      <div className="mb-3 space-y-1">
        <div className="flex items-center gap-3 text-xs">
          <label className="cursor-pointer text-accent hover:text-accent-ink">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleUploadCsv}
              className="sr-only"
            />
          </label>
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-accent hover:text-accent-ink"
          >
            Download template
          </button>
        </div>
        {csvError ? (
          <p className="text-xs text-red-400">{csvError}</p>
        ) : (
          <p className="text-xs text-gray-400">
            CSV columns:{" "}
            <code className="text-gray-300">{SCHEDULE_CSV_HEADER}</code>
          </p>
        )}
      </div>

      {gridRows.length === 0 ? (
        <p className="mb-3 text-xs text-gray-400">
          No schedule rows yet. Add rows manually or upload a CSV.
        </p>
      ) : (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-300">
                <th className="py-1 pr-2 font-medium">Year</th>
                <th className="py-1 pr-2 text-right font-medium">Premium</th>
                <th className="py-1 pr-2 text-right font-medium">Income</th>
                <th className="py-1 pr-2 text-right font-medium">Cash Value</th>
                <th className="py-1 pr-2 text-right font-medium">Death Benefit</th>
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
                      className="w-20 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={row.premiumAmount ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        updateRow(i, { premiumAmount: toOptNum(e.target.value) })
                      }
                      className="w-28 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 placeholder:text-gray-600 focus:border-accent focus:outline-none"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={row.income ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        updateRow(i, { income: toOptNum(e.target.value) })
                      }
                      className="w-28 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 placeholder:text-gray-600 focus:border-accent focus:outline-none"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={row.cashValue ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        updateRow(i, { cashValue: toOptNum(e.target.value) })
                      }
                      className="w-28 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 placeholder:text-gray-600 focus:border-accent focus:outline-none"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={row.deathBenefit ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        updateRow(i, { deathBenefit: toOptNum(e.target.value) })
                      }
                      className="w-28 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-right text-sm text-gray-100 placeholder:text-gray-600 focus:border-accent focus:outline-none"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      aria-label={`Remove year ${row.year}`}
                      className="px-2 text-white hover:text-white"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        className="text-xs text-accent hover:text-accent-ink"
      >
        + Add row
      </button>
    </div>
  );
}
