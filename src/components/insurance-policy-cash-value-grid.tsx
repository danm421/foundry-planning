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
  /** First year of the fixed schedule range (the plan start year). */
  startYear: number;
  /** Last year of the fixed schedule range (the household's second-to-die
   *  death year). */
  endYear: number;
  onChange: (rows: ScheduleRow[]) => void;
}

interface GridRow extends ScheduleRow {
  _id: string;
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

/** True when a row carries at least one override value. Empty rows (just a
 *  year) are display-only scaffolding and are never persisted. */
function hasValue(r: ScheduleRow): boolean {
  return (
    r.cashValue != null ||
    r.premiumAmount != null ||
    r.income != null ||
    r.deathBenefit != null
  );
}

/** Build the fixed display range startYear..endYear, merging any saved values
 *  onto their matching year. Years outside the range are dropped; years with no
 *  saved value render as blank cells. */
export function buildRangeRows(
  startYear: number,
  endYear: number,
  saved: ScheduleRow[],
): ScheduleRow[] {
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear < startYear) {
    return [];
  }
  const byYear = new Map(saved.map((r) => [r.year, r]));
  const out: ScheduleRow[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const s = byYear.get(y);
    out.push({
      year: y,
      cashValue: s?.cashValue,
      premiumAmount: s?.premiumAmount,
      income: s?.income,
      deathBenefit: s?.deathBenefit,
    });
  }
  return out;
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
  startYear,
  endYear,
  onChange,
}: InsurancePolicyCashValueGridProps) {
  // The grid always displays the fixed year range (plan start → second-to-die),
  // with saved values merged on. We keep a local `GridRow[]` carrying stable
  // `_id`s so React keys rows by id (not index) and input focus survives
  // re-renders. Ids are reseeded only when the *desired* display set actually
  // differs from our current view (range change, CSV upload, mount); the
  // equality check stops self-initiated edits from re-minting ids every render.
  const [gridRows, setGridRows] = useState<GridRow[]>(() =>
    buildRangeRows(startYear, endYear, rows).map((r) => ({ ...r, _id: makeId() })),
  );
  const [csvError, setCsvError] = useState<string | null>(null);

  const desired = buildRangeRows(startYear, endYear, rows);

  useEffect(() => {
    if (!isSameSchedule(desired, gridRows)) {
      setGridRows(desired.map((r) => ({ ...r, _id: makeId() })));
    }
    // gridRows/desired intentionally not deps: we resync only when the external
    // inputs (range bounds, saved rows) change. The equality check guards
    // against re-seeding on identical parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startYear, endYear, rows]);

  // Persist only rows that carry a value — the full range is scaffolding and is
  // rebuilt for display on the next open.
  function persist(next: GridRow[]) {
    onChange(stripIds(next.filter(hasValue)));
  }

  function commit(next: GridRow[]) {
    setGridRows(next);
    persist(next);
  }

  function updateRow(index: number, patch: Partial<ScheduleRow>) {
    commit(gridRows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
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
    const next = buildRangeRows(startYear, endYear, parsed).map((r) => ({
      ...r,
      _id: makeId(),
    }));
    commit(next);
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

  function clearSchedule() {
    if (!gridRows.some(hasValue)) return;
    if (
      !window.confirm(
        "Clear all schedule values? The year rows stay; every entered value is removed.",
      )
    ) {
      return;
    }
    commit(
      buildRangeRows(startYear, endYear, []).map((r) => ({ ...r, _id: makeId() })),
    );
  }

  const hasAnyValue = gridRows.some(hasValue);

  return (
    <div>
      {/* CSV upload / template / clear actions */}
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
          <button
            type="button"
            onClick={clearSchedule}
            disabled={!hasAnyValue}
            className="ml-auto text-gray-400 hover:text-red-400 disabled:opacity-40 disabled:hover:text-gray-400"
          >
            Clear schedule
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
          No years to show for this schedule.
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
              </tr>
            </thead>
            <tbody>
              {gridRows.map((row, i) => (
                <tr key={row._id} className="border-t border-gray-800">
                  <td className="py-1 pr-2 tabular-nums text-gray-300">
                    {row.year}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
