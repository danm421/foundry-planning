"use client";

import { useMemo } from "react";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import type { ProjectionYear } from "@/engine";
import { seriesColor } from "@/lib/comparison/series-palette";

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

function activeYears(years: ProjectionYear[]): ProjectionYear[] {
  return years.filter((y) => {
    const t = y.techniqueBreakdown;
    return t && (t.sales.length > 0 || t.purchases.length > 0);
  });
}

function PlanColumn({ plan, yearRange, index }: { plan: ComparisonPlan; yearRange: YearRange | null; index: number }) {
  const txnYears = useMemo(
    () => activeYears(clip(plan.result.years, yearRange)),
    [plan.result.years, yearRange],
  );
  const color = seriesColor(index) ?? "#cbd5e1";
  if (txnYears.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
          <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
        </div>
        <p className="text-sm text-slate-400">No asset transactions in selected range.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      <div className="flex flex-col gap-3">
        {txnYears.map((y) => {
          const sales = y.techniqueBreakdown!.sales;
          const purchases = y.techniqueBreakdown!.purchases;
          const saleProceeds = sales.reduce((s, x) => s + x.netProceeds, 0);
          const purchaseCost = purchases.reduce((s, x) => s + x.purchasePrice, 0);
          const net = saleProceeds - purchaseCost;
          return (
            <div key={y.year} className="rounded border border-slate-700 bg-slate-950/30 p-3 text-sm">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                Transaction — {y.year}
              </div>
              {sales.length > 0 && (
                <table className="mb-2 w-full text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left font-normal">Asset Sold</th>
                      <th className="text-right font-normal">Sale Price</th>
                      <th className="text-right font-normal">Cap Gain</th>
                      <th className="text-right font-normal">Proceeds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.transactionId} className="text-slate-200">
                        <td className="py-0.5">{s.name}</td>
                        <td className="text-right tabular-nums">{fmt(s.saleValue)}</td>
                        <td className="text-right tabular-nums">{fmt(s.capitalGain)}</td>
                        <td className="text-right tabular-nums">{fmt(s.netProceeds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {purchases.length > 0 && (
                <table className="mb-2 w-full text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left font-normal">Asset Purchased</th>
                      <th className="text-right font-normal">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.transactionId} className="text-slate-200">
                        <td className="py-0.5">{p.name}</td>
                        <td className="text-right tabular-nums">{fmt(p.purchasePrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className={`text-xs font-medium ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                Net Surplus: {net >= 0 ? "+" : ""}{fmt(net)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MajorTransactionsComparisonSection({ plans, yearRange }: Props) {
  const colsClass =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : plans.length === 3
          ? "grid-cols-1 md:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Major Transactions</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <PlanColumn key={p.id} plan={p} yearRange={yearRange} index={i} />
        ))}
      </div>
    </section>
  );
}
