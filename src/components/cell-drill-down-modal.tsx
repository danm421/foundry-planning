"use client";

import type { CellDrillProps } from "@/lib/cell-drill/types";
import { formatCurrency } from "@/lib/tax/cell-drill/_shared";

interface Props extends CellDrillProps {
  onClose: () => void;
}

export function CellDrillDownModal({
  title,
  subtitle,
  total,
  totalLabel,
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
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border-2 border-hair-2 ring-1 ring-black/60 bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-ink-2 hover:text-ink">✕</button>
        </div>
        {subtitle && <p className="mb-3 text-xs text-ink-3">{subtitle}</p>}

        {!hasRows ? (
          <p className="py-8 text-center text-sm text-ink-3">
            No contributing items for this year.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g, gi) => (
              <div key={g.label ?? gi}>
                {g.label && (
                  <div className="mb-1 text-xs uppercase tracking-wide text-ink-3">{g.label}</div>
                )}
                <ul className="divide-y divide-hair rounded-md bg-card-2 text-sm">
                  {g.rows.map((r, ri) => {
                    const showBoundary = g.boundaryIndex != null && ri === g.boundaryIndex && ri > 0;
                    return (
                      <li
                        key={r.id}
                        className={`flex flex-col gap-0.5 px-3 py-2 ${showBoundary ? "border-t-2 border-accent/60" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate text-ink-2">{r.label}</span>
                          <span className="tabular-nums text-ink-2">{formatCurrency(r.amount)}</span>
                        </div>
                        {r.meta && <span className="text-xs text-ink-3">{r.meta}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-between border-t border-hair pt-3 text-sm font-semibold text-ink">
          <span>{totalLabel ?? "Total"}</span>
          <span className="tabular-nums">{formatCurrency(total)}</span>
        </div>

        {footnote && <p className="mt-3 text-[11px] italic text-ink-4">{footnote}</p>}
      </div>
    </div>
  );
}
