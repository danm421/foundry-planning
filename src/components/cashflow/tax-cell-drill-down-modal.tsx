"use client";

import type { CellDrillProps } from "@/lib/reports/tax-cell-drill/types";
import { formatCurrency } from "@/lib/reports/tax-cell-drill/_shared";

interface Props extends CellDrillProps {
  onClose: () => void;
}

export function TaxCellDrillDownModal({
  title,
  subtitle,
  total,
  groups,
  footnote,
  onClose,
}: Props) {
  const hasRows = groups.some((g) => g.rows.length > 0);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-300 hover:text-gray-200">✕</button>
        </div>
        {subtitle && <p className="mb-3 text-xs text-gray-400">{subtitle}</p>}

        {!hasRows ? (
          <p className="py-8 text-center text-sm text-gray-400">
            No contributing items for this year.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g, gi) => (
              <div key={g.label ?? gi}>
                {g.label && (
                  <div className="mb-1 text-xs uppercase tracking-wide text-gray-400">{g.label}</div>
                )}
                <ul className="divide-y divide-gray-800 rounded-md bg-gray-800/40 text-sm">
                  {g.rows.map((r, ri) => {
                    const showBoundary = g.boundaryIndex != null && ri === g.boundaryIndex && ri > 0;
                    return (
                      <li
                        key={r.id}
                        className={`flex flex-col gap-0.5 px-3 py-2 ${showBoundary ? "border-t-2 border-amber-400/60" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate text-gray-200">{r.label}</span>
                          <span className="tabular-nums text-gray-200">{formatCurrency(r.amount)}</span>
                        </div>
                        {r.meta && <span className="text-xs text-gray-400">{r.meta}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-between border-t border-gray-700 pt-3 text-sm font-semibold text-gray-100">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(total)}</span>
        </div>

        {footnote && <p className="mt-3 text-[11px] italic text-gray-500">{footnote}</p>}
      </div>
    </div>
  );
}
