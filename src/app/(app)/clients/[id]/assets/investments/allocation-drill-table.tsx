"use client";

import { Fragment, useState } from "react";
import type { AccountContribution } from "@/lib/investments/allocation";
import type { HoldingClassContribution } from "@/lib/investments/holdings-rollup";

interface Props {
  assetClassName: string;
  assetClassColor: string;
  currentPct: number;
  targetPct: number | null;
  contributions: AccountContribution[];
  totalInClass: number;
  onBack: () => void;
  isUnallocated?: boolean;
  holdingsByAccount?: Record<string, HoldingClassContribution[]>;
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
  holdingsByAccount,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (accountId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
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
                const holdings = holdingsByAccount?.[c.accountId] ?? [];
                const canExpand = holdings.length > 0;
                const isOpen = expanded.has(c.accountId);
                return (
                  <Fragment key={c.accountId}>
                    <tr className="border-b border-hair">
                      <td className="px-2 py-2 text-ink">
                        {canExpand ? (
                          <button
                            type="button"
                            onClick={() => toggle(c.accountId)}
                            aria-expanded={isOpen}
                            className="inline-flex items-center gap-1.5 hover:text-ink"
                          >
                            <svg
                              viewBox="0 0 12 12"
                              aria-hidden="true"
                              className={`h-3 w-3 shrink-0 text-ink-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
                            >
                              <path
                                d="M4 2l4 4-4 4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            {c.accountName}
                          </button>
                        ) : (
                          c.accountName
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{dollars(c.valueInClass)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{pct(pctOfClass)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{pct(c.weightInClass)}</td>
                    </tr>
                    {isOpen &&
                      holdings.map((h) => {
                        const pctOfAccountSlice = c.valueInClass > 0 ? h.valueInClass / c.valueInClass : 0;
                        return (
                          <tr key={h.holdingId} className="border-b border-hair bg-card-2/30">
                            <td className="px-2 py-1.5 pl-7 text-ink-2">
                              <span className="text-ink">{h.ticker || h.name}</span>
                              {h.ticker && h.name ? <span className="text-ink-3"> — {h.name}</span> : null}
                              {h.blendWeight < 1 ? (
                                <span className="text-ink-3"> ({pct(h.blendWeight)} of holding)</span>
                              ) : null}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{dollars(h.valueInClass)}</td>
                            <td className="px-2 py-1.5 text-right text-ink-3">—</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{pct(pctOfAccountSlice)}</td>
                          </tr>
                        );
                      })}
                  </Fragment>
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
