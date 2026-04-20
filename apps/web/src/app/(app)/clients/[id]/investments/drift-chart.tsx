"use client";

import { colorForAssetClass } from "@/lib/investments/palette";
import type { DriftRow, AssetClassLite } from "@/lib/investments/allocation";

interface Props {
  drift: DriftRow[];
  assetClasses: AssetClassLite[];
}

function pct(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

export default function DriftChart({ drift, assetClasses }: Props) {
  if (drift.length === 0) {
    return <div className="text-xs text-gray-500">Select a target portfolio to see drift.</div>;
  }

  const sortOrderById = new Map(assetClasses.map((c) => [c.id, c.sortOrder]));
  const max = Math.max(0.01, ...drift.map((r) => Math.abs(r.diffPct)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {drift.map((r) => {
          const widthPct = (Math.abs(r.diffPct) / max) * 50; // max bar = 50% of track width
          const isUnderweight = r.diffPct >= 0;
          return (
            <div key={r.assetClassId} className="grid grid-cols-[120px_1fr_60px] items-center gap-2 text-xs">
              <span className="truncate text-gray-300">{r.name}</span>
              <div className="relative h-4 rounded bg-gray-800/60">
                <div className="absolute inset-y-0 left-1/2 w-px bg-gray-700" />
                <div
                  className="absolute inset-y-0 rounded"
                  style={{
                    left: isUnderweight ? "50%" : `${50 - widthPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: isUnderweight ? "#14b8a6" : "#f59e0b", // teal = need to buy, amber = reduce
                  }}
                />
              </div>
              <span className={`tabular-nums text-right ${isUnderweight ? "text-teal-400" : "text-amber-400"}`}>{pct(r.diffPct)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-col gap-1 border-t border-gray-800 pt-3">
        {drift.map((r) => {
          const sortOrder = sortOrderById.get(r.assetClassId) ?? 0;
          const color = colorForAssetClass({ sortOrder });
          return (
            <div key={`legend-${r.assetClassId}`} className="flex items-center justify-between text-xs text-gray-400">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                {r.name}
              </span>
              <span className="tabular-nums">{pct(r.diffPct)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
