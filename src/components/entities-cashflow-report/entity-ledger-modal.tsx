"use client";

import type { LedgerSection, LedgerSourceRow } from "@/lib/entity-ledger";
import { formatCurrency } from "./tokens";

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
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border-2 border-ink-3 bg-card p-6 shadow-xl ring-1 ring-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">
            {entityName} · {year} · {SECTION_TITLES[section]}
          </h3>
          <button
            onClick={onClose}
            className="text-ink-2 hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">No contributors for this column.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-3">
              <tr className="border-b border-hair">
                <th className="px-2 py-1.5 text-left font-normal">Source</th>
                <th className="px-2 py-1.5 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {rows.map((r, i) => {
                const isAnchor = r.sourceKind === "walk-anchor";
                const isNegative = r.amount < 0;
                return (
                  <tr
                    key={`${r.sourceKind}:${r.sourceId ?? i}`}
                    className={
                      isAnchor
                        ? "border-b-2 border-hair-2 font-medium"
                        : "border-b border-hair last:border-b-0"
                    }
                  >
                    <td className="px-2 py-1.5 text-left">{r.label}</td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        isNegative ? "text-rose-300" : ""
                      }`}
                    >
                      {formatCurrency(r.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="text-ink">
              <tr className="border-t border-hair-2 font-semibold">
                <td className="px-2 py-2 text-left">
                  {section === "ending" ? "End of year" : "Total"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(total)}</td>
              </tr>
              {!reconciles && (
                <tr>
                  <td colSpan={2} className="px-2 py-1 text-right text-xs text-amber-400">
                    Sources sum to {formatCurrency(sum)} — reconciliation gap of{" "}
                    {formatCurrency(total - sum)}.
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
