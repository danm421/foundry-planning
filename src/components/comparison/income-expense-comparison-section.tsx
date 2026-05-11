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

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const INCOME_SERIES = [
  { label: "Salaries", color: "#16a34a", valueFor: (y: ProjectionYear) => y.income.salaries },
  { label: "Social Security", color: "#2563eb", valueFor: (y: ProjectionYear) => y.income.socialSecurity },
  { label: "Business", color: "#0891b2", valueFor: (y: ProjectionYear) => y.income.business },
  { label: "Trust", color: "#7c3aed", valueFor: (y: ProjectionYear) => y.income.trust },
  { label: "Deferred", color: "#ea580c", valueFor: (y: ProjectionYear) => y.income.deferred },
  { label: "Capital Gains", color: "#facc15", valueFor: (y: ProjectionYear) => y.income.capitalGains },
  { label: "Other Income", color: "#99f6e4", valueFor: (y: ProjectionYear) => y.income.other },
];

const EXPENSE_SERIES = [
  { label: "Living", color: "#94a3b8", valueFor: (y: ProjectionYear) => -y.expenses.living },
  { label: "Real Estate", color: "#64748b", valueFor: (y: ProjectionYear) => -y.expenses.realEstate },
  { label: "Insurance", color: "#475569", valueFor: (y: ProjectionYear) => -y.expenses.insurance },
  { label: "Taxes", color: "#334155", valueFor: (y: ProjectionYear) => -y.expenses.taxes },
  { label: "Debt service", color: "#ef4444", valueFor: (y: ProjectionYear) => -y.expenses.liabilities },
  { label: "Other Expenses", color: "#dc2626", valueFor: (y: ProjectionYear) => -y.expenses.other },
];

function clip(years: ProjectionYear[], range: YearRange | null): ProjectionYear[] {
  if (!range) return years;
  return years.filter((y) => y.year >= range.start && y.year <= range.end);
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
  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: [
        ...INCOME_SERIES.map((s) => ({
          label: s.label,
          data: years.map(s.valueFor),
          backgroundColor: s.color,
          stack: "ie",
        })),
        ...EXPENSE_SERIES.map((s) => ({
          label: s.label,
          data: years.map(s.valueFor),
          backgroundColor: s.color,
          stack: "ie",
        })),
      ],
    }),
    [years],
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

export function IncomeExpenseComparisonSection({ plans, yearRange }: Props) {
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
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Income &amp; Expenses over time</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {plans.map((p, i) => (
          <PlanChart key={p.id} plan={p} yearRange={yearRange} index={i} />
        ))}
      </div>
    </section>
  );
}
