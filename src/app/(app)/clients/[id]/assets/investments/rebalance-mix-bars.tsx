"use client";

import MoneyText from "@/components/money-text";
import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";

export function RebalanceMixBars({ result }: { result: RebalanceComputeResult }) {
  const rows = [...result.assetMixDelta].sort((a, b) => b.targetPct - a.targetPct);

  return (
    <div className="rounded-lg border border-hair-2 bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-ink">Asset mix — current vs. proposed</h3>

      {rows.length === 0 ? (
        <p className="py-3 text-center text-ink-4">No asset class data available.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-ink-3" /> Current
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-accent" /> Proposed
            </span>
          </div>

          {rows.map((row) => (
            <div key={row.assetClassId} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
              <span className="truncate text-xs text-ink-2">{row.name}</span>
              <div className="space-y-1">
                <div className="h-2.5 overflow-hidden rounded bg-card-2">
                  <div className="h-full rounded bg-ink-3" style={{ width: `${row.currentPct * 100}%` }} />
                </div>
                <div className="h-2.5 overflow-hidden rounded bg-card-2">
                  <div className="h-full rounded bg-accent" style={{ width: `${row.targetPct * 100}%` }} />
                </div>
              </div>
              <span className="text-right text-[11px] tabular-nums text-ink-3">
                {row.diffPct === 0 ? "—" : (
                  <>
                    {row.diffPct > 0 ? "+" : ""}
                    <MoneyText value={row.diffPct} format="pct" />
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
