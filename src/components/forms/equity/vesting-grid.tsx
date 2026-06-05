"use client";

export interface TrancheRow {
  /** Stable client-only identity for React keys (never sent to the API).
   *  Tranche rows have no server id while being edited, and index keys would
   *  recycle DOM/focus state on row removal. */
  _key: string;
  vestDate: string;
  shares: string;
  sharesExercised: string;
  sharesSold: string;
}

interface VestingGridProps {
  rows: TrancheRow[];
  onChange: (rows: TrancheRow[]) => void;
  grantType: "rsu" | "nqso" | "iso";
}

// Monotonic counter — unique within the session, which is all a React key needs.
let _trancheKeySeq = 0;
export function newTrancheKey(): string {
  return `tr-${_trancheKeySeq++}`;
}

function emptyRow(): TrancheRow {
  return { _key: newTrancheKey(), vestDate: "", shares: "", sharesExercised: "", sharesSold: "" };
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

export default function VestingGrid({ rows, onChange, grantType }: VestingGridProps) {
  const isRsu = grantType === "rsu";

  function setRow(index: number, patch: Partial<TrancheRow>) {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(next);
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...rows, emptyRow()]);
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
                      onChange={(e) => setRow(i, { shares: e.target.value })}
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
      <button
        type="button"
        onClick={addRow}
        className="text-xs text-accent hover:text-accent-ink"
      >
        + Add vest tranche
      </button>
    </div>
  );
}
