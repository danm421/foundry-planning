// src/components/balance-sheet-report/household-summary-panel.tsx
"use client";

import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import type { DonutSlice } from "./view-model";
import type { OwnerColumns } from "./household-columns";

// `Pie` registers PieController itself; we add the shared element + plugins.
ChartJS.register(ArcElement, Tooltip, Legend);

const fmt = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface HouseholdSummaryPanelProps {
  donut: DonutSlice[];
  totalAssets: OwnerColumns;
  totalLiabilities: OwnerColumns;
  netWorth: OwnerColumns;
  hasSpouse: boolean;
  clientLabel: string;
  spouseLabel: string | null;
}

export default function HouseholdSummaryPanel({
  donut,
  totalAssets,
  totalLiabilities,
  netWorth,
  hasSpouse,
  clientLabel,
  spouseLabel,
}: HouseholdSummaryPanelProps) {
  const assetTotal = donut.reduce((sum, s) => sum + s.value, 0);
  const hasAssets = assetTotal > 0;
  const slices = hasAssets ? donut.map((s) => ({ ...s, pct: Math.round((s.value / assetTotal) * 100) })) : [];
  const showSplit = hasSpouse && spouseLabel != null;

  return (
    <div className="rounded-lg border border-hair bg-card">
      {/* ── Asset allocation ─────────────────────────────────────────────── */}
      <section className="border-b border-hair p-4">
        <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-ink-3">Assets by Type</h3>
        {!hasAssets ? (
          <p className="py-6 text-center text-sm text-ink-3">No assets</p>
        ) : (
          <>
            <div className="relative mx-auto h-40 w-40">
              <Pie
                data={{
                  labels: donut.map((s) => s.label),
                  datasets: [
                    {
                      data: donut.map((s) => s.value),
                      backgroundColor: donut.map((s) => s.hex),
                      borderColor: "var(--color-card)",
                      borderWidth: 2,
                    },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx: { label: string; parsed: number }) =>
                          `${ctx.label}: ${fmt(ctx.parsed)} (${Math.round((ctx.parsed / assetTotal) * 100)}%)`,
                      },
                    },
                  },
                }}
              />
            </div>
            <ul className="mt-3 space-y-1.5">
              {slices.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-xs">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.hex }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
                  <span className="tabular-nums text-ink-3">{s.pct}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Net worth summary ────────────────────────────────────────────── */}
      <section className="p-4">
        <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-ink-3">Net Worth Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-ink-4">
                <th className="py-1 pr-2 text-left font-medium" />
                <th className="px-2 py-1 text-right font-medium">{clientLabel}</th>
                {showSplit && <th className="px-2 py-1 text-right font-medium">{spouseLabel}</th>}
                {showSplit && <th className="px-2 py-1 text-right font-medium">Joint</th>}
                <th className="px-2 py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <SummaryRow label="Total Assets" cols={totalAssets} showSplit={showSplit} />
              <SummaryRow label="Total Liabilities" cols={totalLiabilities} showSplit={showSplit} variant="negative" />
              <SummaryRow label="Net Worth" cols={netWorth} showSplit={showSplit} variant="netWorth" />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryRow({
  label,
  cols,
  showSplit,
  variant = "default",
}: {
  label: string;
  cols: OwnerColumns;
  showSplit: boolean;
  variant?: "default" | "negative" | "netWorth";
}) {
  const cell = (v: number) => {
    if (variant === "negative") {
      return <td className="px-2 py-1.5 text-right tabular-nums text-crit">{v === 0 ? "—" : `(${fmt(v)})`}</td>;
    }
    if (variant === "netWorth") {
      return <td className={`px-2 py-1.5 text-right tabular-nums ${v < 0 ? "text-crit" : "text-good"}`}>{fmt(v)}</td>;
    }
    return <td className="px-2 py-1.5 text-right tabular-nums text-ink">{fmt(v)}</td>;
  };
  return (
    <tr className="border-t border-hair">
      <td className={`py-1.5 pr-2 ${variant === "netWorth" ? "font-medium text-ink" : "text-ink-2"}`}>{label}</td>
      {cell(cols.client)}
      {showSplit && cell(cols.spouse)}
      {showSplit && cell(cols.joint)}
      {cell(cols.total)}
    </tr>
  );
}
