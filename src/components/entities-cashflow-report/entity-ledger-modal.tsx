"use client";

import type { LedgerSection, LedgerSourceRow } from "@/lib/entity-ledger";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const SECTION_TITLES: Record<LedgerSection, string> = {
  growth: "Growth",
  income: "Income",
  expenses: "Expenses",
  ending: "Ending value",
};

interface Props {
  open: boolean;
  onClose: () => void;
  entityName: string;
  year: number;
  section: LedgerSection;
  rows: LedgerSourceRow[];
  total: number;
}

export default function EntityLedgerModal({
  open,
  onClose,
  entityName,
  year,
  section,
  rows,
  total,
}: Props) {
  if (!open) return null;
  const sum = rows.reduce((a, r) => a + r.amount, 0);
  const reconciles = Math.abs(sum - total) < 0.5;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border-2 border-ink-3 bg-gray-900 p-6 shadow-xl ring-1 ring-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">
            {entityName} · {year} · {SECTION_TITLES[section]}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-300 hover:text-gray-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">No contributors for this column.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr className="border-b border-gray-800">
                <th className="px-2 py-1.5 text-left font-normal">Source</th>
                <th className="px-2 py-1.5 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody className="text-gray-100">
              {rows.map((r, i) => (
                <tr
                  key={`${r.sourceKind}:${r.sourceId ?? i}`}
                  className="border-b border-gray-800/60 last:border-b-0"
                >
                  <td className="px-2 py-1.5 text-left">{r.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {fmt.format(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-gray-100">
              <tr className="border-t border-gray-700 font-semibold">
                <td className="px-2 py-2 text-left">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt.format(total)}</td>
              </tr>
              {!reconciles && (
                <tr>
                  <td colSpan={2} className="px-2 py-1 text-right text-xs text-amber-400">
                    Sources sum to {fmt.format(sum)} — reconciliation gap of{" "}
                    {fmt.format(total - sum)}.
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
