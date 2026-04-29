"use client";

import { useState } from "react";

export interface AssetClassOption {
  id: string;
  name: string;
  slug: string | null;
  geometricReturn: number;
}

interface Allocation {
  assetClassId: string;
  weight: number;
}

interface AssetMixTabProps {
  assetClasses: AssetClassOption[];
  /** Name of the inherited portfolio (shown as info banner) */
  inheritedPortfolioName?: string;
  /** Current allocations (always editable) */
  allocations: Allocation[];
  onChange: (allocations: Allocation[]) => void;
}

export function AssetMixTab({
  assetClasses,
  inheritedPortfolioName,
  allocations,
  onChange,
}: AssetMixTabProps) {
  const [hideZero, setHideZero] = useState(false);

  const displayAllocations = allocations;

  const weightMap = new Map<string, number>();
  for (const a of displayAllocations) {
    weightMap.set(a.assetClassId, a.weight);
  }

  const totalAllocated = displayAllocations.reduce((sum, a) => sum + a.weight, 0);
  const unclassified = Math.max(0, 1 - totalAllocated);

  let blendedReturn = 0;
  for (const ac of assetClasses) {
    const w = weightMap.get(ac.id) ?? 0;
    blendedReturn += w * ac.geometricReturn;
  }
  const inflationClass = assetClasses.find((ac) => ac.slug === "inflation");
  if (unclassified > 0 && inflationClass) {
    blendedReturn += unclassified * inflationClass.geometricReturn;
  }

  const visibleClasses = hideZero
    ? assetClasses.filter((ac) => (weightMap.get(ac.id) ?? 0) > 0)
    : assetClasses;

  function handleWeightChange(assetClassId: string, value: string) {
    const numValue = value === "" ? 0 : parseFloat(value) / 100;
    if (isNaN(numValue) || numValue < 0 || numValue > 1) return;

    const existing = allocations.find((a) => a.assetClassId === assetClassId);
    let updated: Allocation[];
    if (existing) {
      updated = allocations.map((a) =>
        a.assetClassId === assetClassId ? { ...a, weight: numValue } : a
      );
    } else {
      updated = [...allocations, { assetClassId, weight: numValue }];
    }
    const newTotal = updated.reduce((sum, a) => sum + a.weight, 0);
    if (newTotal > 1.0001) return;
    onChange(updated);
  }

  return (
    <div className="space-y-4">
      {/* Blended Return summary */}
      <div className="flex items-center justify-between rounded-md border border-gray-600 px-3 py-2 bg-gray-800">
        <span className="text-sm font-medium text-gray-300">Blended Return</span>
        <span className="text-sm font-semibold text-gray-100">
          {(blendedReturn * 100).toFixed(2)}%
        </span>
      </div>

      {/* Info banner when allocations are inherited from a portfolio */}
      {inheritedPortfolioName && (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent-ink">
          Pre-filled from <strong>{inheritedPortfolioName}</strong>. Edit to customize.
        </div>
      )}

      {/* Hide zero toggle */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            id="hide-zero"
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
          />
          <span className="text-sm text-gray-300">Hide 0% allocations</span>
        </label>
      </div>

      {/* Asset class rows — two-column grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {visibleClasses.map((ac) => {
          const weight = weightMap.get(ac.id) ?? 0;
          return (
            <div
              key={ac.id}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-sm flex-1 truncate text-gray-200">{ac.name}</span>
              <span className="text-xs text-gray-400 w-14 text-right shrink-0">
                {(ac.geometricReturn * 100).toFixed(2)}%
              </span>
              <div className="flex items-center gap-1 w-20 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={weight > 0 ? (weight * 100).toFixed(1) : ""}
                  placeholder="0"
                  onChange={(e) => handleWeightChange(ac.id, e.target.value)}
                  className="h-7 w-full rounded-md border border-gray-600 bg-gray-800 px-2 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-sm text-gray-400">%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unclassified row */}
      {unclassified > 0.0001 && (
        <div className="flex items-center justify-between gap-3 border-t border-gray-700 pt-2">
          <span className="text-sm flex-1 text-gray-400 italic">
            Unclassified
          </span>
          <span className="text-xs text-gray-400 w-16 text-right">
            {inflationClass
              ? `${(inflationClass.geometricReturn * 100).toFixed(2)}%`
              : "—"}
          </span>
          <span className="text-sm font-medium w-20 text-right text-gray-100">
            {(unclassified * 100).toFixed(1)}%
          </span>
        </div>
      )}

      {unclassified > 0.0001 && (
        <p className="text-xs text-gray-400">
          Unclassified portion grows at the Inflation rate
          {inflationClass
            ? ` (${(inflationClass.geometricReturn * 100).toFixed(2)}%)`
            : ""}
          .
        </p>
      )}

      {/* Total row */}
      <div className="flex items-center justify-between gap-3 border-t border-gray-700 pt-2 font-medium">
        <span className="text-sm flex-1 text-gray-200">Total</span>
        <span className="w-16" />
        <span className="text-sm w-20 text-right text-gray-100">100.0%</span>
      </div>
    </div>
  );
}
