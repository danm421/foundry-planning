"use client";

import type { AccountContribution } from "@/lib/investments/allocation";

interface Props {
  assetClassName: string;
  assetClassColor: string;
  currentPct: number;
  targetPct: number | null;
  contributions: AccountContribution[];
  totalInClass: number;
  onBack: () => void;
  isUnallocated?: boolean;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function dollars(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function AllocationDrillTable({
  assetClassName,
  assetClassColor,
  currentPct,
  targetPct,
  contributions,
  totalInClass,
  onBack,
  isUnallocated = false,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-ink-2 hover:text-ink"
      >
        ← All asset classes
      </button>

      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: assetClassColor }} />
          {assetClassName}
        </div>
        {!isUnallocated && (
          <div className="mt-1 text-xs text-ink-3">
            Current {pct(currentPct)}
            {targetPct !== null && (
              <>
                {"  ·  "}
                Target {pct(targetPct)}
              </>
            )}
          </div>
        )}
      </div>

      {contributions.length === 0 ? (
        <div className="text-xs text-ink-3">No accounts contribute to this asset class.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-hair text-ink-3">
                <th className="px-2 py-2 font-medium">Account</th>
                <th className="px-2 py-2 text-right font-medium">$ class</th>
                <th className="px-2 py-2 text-right font-medium">% class</th>
                <th className="px-2 py-2 text-right font-medium">% account</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => {
                const pctOfClass = totalInClass > 0 ? c.valueInClass / totalInClass : 0;
                return (
                  <tr key={c.accountId} className="border-b border-hair">
                    <td className="px-2 py-2 text-ink">{c.accountName}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{dollars(c.valueInClass)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{pct(pctOfClass)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{pct(c.weightInClass)}</td>
                  </tr>
                );
              })}
              {(() => {
                const summedPctOfClass = totalInClass > 0
                  ? contributions.reduce((acc, c) => acc + c.valueInClass / totalInClass, 0)
                  : 0;
                return (
                  <tr className="border-t border-hair-2 font-semibold text-ink">
                    <td className="px-2 py-2">Total</td>
                    <td className="px-2 py-2 text-right tabular-nums">{dollars(totalInClass)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pct(summedPctOfClass)}</td>
                    <td className="px-2 py-2 text-right text-ink-3">—</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
