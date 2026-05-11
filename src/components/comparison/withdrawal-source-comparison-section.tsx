"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { YearRange } from "@/lib/comparison/layout-schema";
import { seriesColor } from "@/lib/comparison/series-palette";
import {
  buildAccountSourceMap,
  SOURCE_LABELS,
  SOURCE_COLORS,
  SOURCE_ORDER,
  type WithdrawalSourceCategory,
} from "@/lib/comparison/withdrawal-categories";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
}

function categoryTotals(
  years: ProjectionYear[],
  sourceMap: Record<string, WithdrawalSourceCategory>,
): Record<WithdrawalSourceCategory, number[]> {
  const totals = Object.fromEntries(
    SOURCE_ORDER.map((k) => [k, new Array<number>(years.length).fill(0)]),
  ) as Record<WithdrawalSourceCategory, number[]>;

  years.forEach((y, i) => {
    totals["social-security"][i] += y.income.socialSecurity;
    totals.pension[i] += y.income.deferred;
    for (const [accId, amt] of Object.entries(y.withdrawals.byAccount)) {
      const cat = sourceMap[accId] ?? "other";
      totals[cat][i] += amt;
    }
  });
  return totals;
}

interface Props {
  plans: ComparisonPlan[];
  yearRange: YearRange | null;
}

function PlanChart({
  plan,
  yearRange,
  index,
}: {
  plan: ComparisonPlan;
  yearRange: YearRange | null;
  index: number;
}) {
  const years = useMemo(
    () => clip(plan.result.years, yearRange),
    [plan.result.years, yearRange],
  );
  const sourceMap = useMemo(
    () => buildAccountSourceMap(plan.tree.accounts ?? []),
    [plan.tree.accounts],
  );
  const totals = useMemo(
    () => categoryTotals(years, sourceMap),
    [years, sourceMap],
  );

  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: SOURCE_ORDER.map((cat) => ({
        label: SOURCE_LABELS[cat],
        data: totals[cat],
        backgroundColor: SOURCE_COLORS[cat],
        stack: "src",
      })),
    }),
    [years, totals],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: "#d1d5db", boxWidth: 10, padding: 8, font: { size: 10 } },
        },
        tooltip: { backgroundColor: "#1f2937" },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
        y: { stacked: true, ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
      },
    }),
    [],
  );
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      <div style={{ height: 240 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

export function WithdrawalSourceComparisonSection({ plans, yearRange }: Props) {
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
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Withdrawal Source</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <PlanChart key={p.id} plan={p} yearRange={yearRange} index={i} />
        ))}
      </div>
    </section>
  );
}
