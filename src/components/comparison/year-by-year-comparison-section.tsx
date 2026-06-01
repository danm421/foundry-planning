"use client";

import { useMemo, useState } from "react";
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";

type Metric = "income" | "expenses" | "net" | "withdrawals";

const TABS: { key: Metric; label: string; valueFor: (y: ProjectionYear) => number }[] = [
  { key: "income", label: "Income", valueFor: (y) => y.totalIncome },
  { key: "expenses", label: "Expenses", valueFor: (y) => y.totalExpenses },
  { key: "net", label: "Net Cash Flow", valueFor: (y) => y.netCashFlow },
  { key: "withdrawals", label: "Withdrawals", valueFor: (y) => y.withdrawals.total },
];

const fmtMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmtDelta(v: number): string {
  if (v === 0) return "$0";
  const abs = fmtMoney.format(Math.abs(v));
  return `${v < 0 ? "−" : "+"}${abs}`;
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

export function YearByYearComparisonSection({ plans, yearRange }: Props) {
  const [activeKey, setActiveKey] = useState<Metric>("income");
  const tab = TABS.find((t) => t.key === activeKey)!;
  const showDelta = plans.length >= 2;

  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const p of plans) for (const y of p.result.years) set.add(y.year);
    const sorted = [...set].sort((a, b) => a - b);
    if (!yearRange) return sorted;
    return sorted.filter((y) => y >= yearRange.start && y <= yearRange.end);
  }, [plans, yearRange]);

  const valueAt = (plan: ComparisonPlan, year: number): number | null => {
    const y = plan.result.years.find((y) => y.year === year);
    return y ? tab.valueFor(y) : null;
  };

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-ink">Year-by-year detail</h2>

      <div className="mb-3 flex gap-1 border-b border-hair" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === activeKey}
            onClick={() => setActiveKey(t.key)}
            className={`px-3 py-2 text-sm ${
              t.key === activeKey
                ? "border-b-2 border-accent text-ink"
                : "text-ink-4 hover:text-ink-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-[60vh] overflow-auto rounded border border-hair">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr>
              <th className="sticky left-0 z-20 bg-card/95 px-3 py-2 text-left font-medium text-ink-2">
                Year
              </th>
              {plans.map((p) => (
                <th key={p.id} className="px-3 py-2 text-right font-medium text-ink-2">
                  {p.label}
                </th>
              ))}
              {showDelta &&
                plans.slice(1).map((p) => (
                  <th
                    key={`d-${p.id}`}
                    className="px-3 py-2 text-right font-medium text-ink-2"
                  >
                    Δ vs {plans[0].label}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {allYears.map((year) => {
              const baseV = valueAt(plans[0], year) ?? 0;
              return (
                <tr key={year} className="border-t border-hair">
                  <td className="sticky left-0 bg-card px-3 py-1.5 text-left text-ink-2">
                    {year}
                  </td>
                  {plans.map((p) => {
                    const v = valueAt(p, year);
                    return (
                      <td
                        key={p.id}
                        className="px-3 py-1.5 text-right tabular-nums text-ink-2"
                      >
                        {v === null ? "—" : fmtMoney.format(v)}
                      </td>
                    );
                  })}
                  {showDelta &&
                    plans.slice(1).map((p) => {
                      const v = valueAt(p, year);
                      if (v === null)
                        return (
                          <td key={`d-${p.id}`} className="px-3 py-1.5 text-right">
                            —
                          </td>
                        );
                      const d = v - baseV;
                      const cls =
                        d > 0
                          ? "text-good"
                          : d < 0
                            ? "text-crit"
                            : "text-ink-4";
                      return (
                        <td
                          key={`d-${p.id}`}
                          className={`px-3 py-1.5 text-right tabular-nums ${cls}`}
                        >
                          {fmtDelta(d)}
                        </td>
                      );
                    })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
