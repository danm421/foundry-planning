"use client";

import { useState } from "react";

export interface TrancheRow {
  /** Stable client-only identity for React keys (never sent to the API).
   *  Tranche rows have no server id while being edited, and index keys would
   *  recycle DOM/focus state on row removal. */
  _key: string;
  vestDate: string;
  shares: string;
  sharesExercised: string;
  sharesSold: string;
  /** Client-only: true once the user types a share amount, which "locks" the
   *  row so auto-fill divides only the remaining shares across the other rows.
   *  Never sent to the API (buildBody picks fields explicitly). */
  sharesEdited?: boolean;
}

/** Auto-fill cadence for generating vest dates + dividing shares. */
export type VestFrequency = "none" | "annual" | "quarterly" | "monthly";

const PERIOD_MONTHS: Record<Exclude<VestFrequency, "none">, number> = {
  annual: 12,
  quarterly: 3,
  monthly: 1,
};

interface VestingGridProps {
  rows: TrancheRow[];
  onChange: (rows: TrancheRow[]) => void;
  grantType: "rsu" | "nqso" | "iso";
  /** Total shares granted (string from the editor) — divided across auto rows. */
  sharesGranted: string;
  /** Grant date (ISO string) — anchors the first auto-filled vest date. */
  grantDate: string;
}

// Monotonic counter — unique within the session, which is all a React key needs.
let _trancheKeySeq = 0;
export function newTrancheKey(): string {
  return `tr-${_trancheKeySeq++}`;
}

function emptyRow(): TrancheRow {
  return { _key: newTrancheKey(), vestDate: "", shares: "", sharesExercised: "", sharesSold: "" };
}

/** Add whole months to an ISO date, clamping the day to the target month's
 *  last day so e.g. Jan 31 + 1 month → Feb 28, not an overflow into March. */
function addMonths(iso: string, months: number): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return "";
  const y = Number(parts[0]);
  const m = Number(parts[1]); // 1-based
  const d = Number(parts[2]);
  if (!y || !m || !d) return "";
  const zeroBased = m - 1 + months;
  const ny = y + Math.floor(zeroBased / 12);
  const nm = ((zeroBased % 12) + 12) % 12; // 0-based month
  const lastDay = new Date(ny, nm + 1, 0).getDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Next vest date: previous dated row + one period, falling back to the grant
 *  date + one period for the first tranche. Empty if no anchor is available. */
function nextVestDate(rows: TrancheRow[], grantDate: string, months: number): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].vestDate) return addMonths(rows[i].vestDate, months);
  }
  return grantDate ? addMonths(grantDate, months) : "";
}

/** Split `total` into `n` amounts that sum exactly to `total`. Whole numbers
 *  when `total` is an integer (remainder lands on the last rows); otherwise
 *  2-decimal amounts with the last row absorbing any rounding drift. */
function distributeShares(total: number, n: number): number[] {
  if (n <= 0) return [];
  if (total <= 0) return Array(n).fill(0);
  if (Number.isInteger(total)) {
    const base = Math.floor(total / n);
    const rem = total - base * n; // 0..n-1
    return Array.from({ length: n }, (_, i) => base + (i >= n - rem ? 1 : 0));
  }
  const per = Math.round((total / n) * 100) / 100;
  const arr = Array.from({ length: n }, () => per);
  arr[n - 1] = Math.round((total - per * (n - 1)) * 100) / 100;
  return arr;
}

/** Re-divide shares across the "auto" (un-edited) rows. Edited rows keep their
 *  value and only the remaining shares are split across the rest. */
function redistribute(rows: TrancheRow[], sharesGranted: string): TrancheRow[] {
  const total = parseFloat(sharesGranted) || 0;
  const autoIndices = rows.map((r, i) => (r.sharesEdited ? -1 : i)).filter((i) => i >= 0);
  if (autoIndices.length === 0) return rows;
  const manualSum = rows.reduce(
    (acc, r) => (r.sharesEdited ? acc + (parseFloat(r.shares) || 0) : acc),
    0,
  );
  const amounts = distributeShares(Math.max(0, total - manualSum), autoIndices.length);
  const next = rows.slice();
  autoIndices.forEach((rowIdx, k) => {
    const amt = amounts[k] ?? 0;
    next[rowIdx] = { ...next[rowIdx], shares: amt ? String(amt) : "" };
  });
  return next;
}

function computeRemaining(row: TrancheRow, isRsu: boolean): number {
  const shares = parseFloat(row.shares) || 0;
  const exercised = isRsu ? 0 : parseFloat(row.sharesExercised) || 0;
  const sold = parseFloat(row.sharesSold) || 0;
  return Math.max(0, shares - exercised - sold);
}

const inputCls =
  "rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-accent focus:outline-none w-full";
const thCls = "border-b border-gray-600 pb-1.5 text-xs font-medium text-gray-400 text-right first:text-left";
const tdCls = "py-1 pr-1 last:pr-0 text-right first:text-left";

export default function VestingGrid({ rows, onChange, grantType, sharesGranted, grantDate }: VestingGridProps) {
  const isRsu = grantType === "rsu";
  const [frequency, setFrequency] = useState<VestFrequency>("none");

  function setRow(index: number, patch: Partial<TrancheRow>) {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(next);
  }

  function removeRow(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(frequency === "none" ? next : redistribute(next, sharesGranted));
  }

  function addRow() {
    if (frequency === "none") {
      onChange([...rows, emptyRow()]);
      return;
    }
    const months = PERIOD_MONTHS[frequency];
    const newRow: TrancheRow = {
      ...emptyRow(),
      vestDate: nextVestDate(rows, grantDate, months),
      sharesEdited: false,
    };
    onChange(redistribute([...rows, newRow], sharesGranted));
  }

  // Totals
  const totalShares = rows.reduce((acc, r) => acc + (parseFloat(r.shares) || 0), 0);
  const totalExercised = isRsu ? 0 : rows.reduce((acc, r) => acc + (parseFloat(r.sharesExercised) || 0), 0);
  const totalSold = rows.reduce((acc, r) => acc + (parseFloat(r.sharesSold) || 0), 0);
  const totalRemaining = rows.reduce((acc, r) => acc + computeRemaining(r, isRsu), 0);

  function fmtNum(n: number): string {
    if (n === 0 && rows.length === 0) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  const addLabel =
    frequency === "none" ? "+ Add vest tranche" : `+ Add ${frequency} tranche`;
  const needsGrantDate = frequency !== "none" && !grantDate && !rows.some((r) => r.vestDate);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-gray-600 bg-gray-900">
        <table className="w-full min-w-[480px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-gray-600">
              <th className={thCls + " pl-3 w-36"}>Vest Date</th>
              <th className={thCls + " w-24"}>Shares</th>
              {!isRsu && <th className={thCls + " w-24"}>Exercised</th>}
              <th className={thCls + " w-24"}>Sold</th>
              <th className={thCls + " w-24"}>Remaining</th>
              <th className={thCls + " w-8 pr-3"}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={isRsu ? 5 : 6}
                  className="px-3 py-3 text-center text-xs text-gray-500 italic"
                >
                  No tranches yet. Add one below.
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const remaining = computeRemaining(row, isRsu);
              return (
                <tr key={row._key} className="border-b border-gray-700/50 last:border-0">
                  <td className={tdCls + " pl-3"}>
                    <input
                      type="date"
                      value={row.vestDate}
                      onChange={(e) => setRow(i, { vestDate: e.target.value })}
                      className={inputCls}
                    />
                  </td>
                  <td className={tdCls}>
                    <input
                      type="number"
                      min={0}
                      value={row.shares}
                      onChange={(e) => setRow(i, { shares: e.target.value, sharesEdited: true })}
                      placeholder="0"
                      className={inputCls + " text-right"}
                    />
                  </td>
                  {!isRsu && (
                    <td className={tdCls}>
                      <input
                        type="number"
                        min={0}
                        value={row.sharesExercised}
                        onChange={(e) => setRow(i, { sharesExercised: e.target.value })}
                        placeholder="0"
                        className={inputCls + " text-right"}
                      />
                    </td>
                  )}
                  <td className={tdCls}>
                    <input
                      type="number"
                      min={0}
                      value={row.sharesSold}
                      onChange={(e) => setRow(i, { sharesSold: e.target.value })}
                      placeholder="0"
                      className={inputCls + " text-right"}
                    />
                  </td>
                  <td className={tdCls + " text-gray-300 pr-2"}>
                    {remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className={tdCls + " pr-3"}>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      title="Remove tranche"
                      className="text-gray-500 hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-600 bg-gray-800/50">
                <td className="pl-3 py-1.5 text-xs font-medium text-gray-400">Total</td>
                <td className={tdCls + " font-medium text-gray-300"}>
                  {fmtNum(totalShares)}
                </td>
                {!isRsu && (
                  <td className={tdCls + " font-medium text-gray-300"}>
                    {fmtNum(totalExercised)}
                  </td>
                )}
                <td className={tdCls + " font-medium text-gray-300"}>
                  {fmtNum(totalSold)}
                </td>
                <td className={tdCls + " font-medium text-gray-300 pr-2"}>
                  {fmtNum(totalRemaining)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          className="text-xs text-accent hover:text-accent-ink"
        >
          {addLabel}
        </button>
        <div className="flex items-center gap-1.5">
          <label htmlFor="vest-frequency" className="text-xs text-gray-400">
            Auto-fill
          </label>
          <select
            id="vest-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as VestFrequency)}
            className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100 focus:border-accent focus:outline-none"
          >
            <option value="none">Manual</option>
            <option value="annual">Annual</option>
            <option value="quarterly">Quarterly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>
      {frequency !== "none" && (
        <p className="text-xs text-gray-500">
          {needsGrantDate
            ? "Set a grant date on Account Details to auto-fill vest dates. Shares are split evenly across tranches."
            : "Each added tranche advances one period and re-splits the granted shares evenly. Edit any amount to lock it — the rest keep dividing."}
        </p>
      )}
    </div>
  );
}
