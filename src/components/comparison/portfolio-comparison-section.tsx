"use client";

import { useMemo } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ProjectionYear } from "@/engine";
import { PortfolioOverlayChart } from "@/components/cashflow/charts/portfolio-overlay-chart";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const PORTFOLIO_SERIES = [
  { label: "Cash", color: "#9ca3af", valueFor: (y: ProjectionYear) => y.portfolioAssets.cashTotal },
  { label: "Taxable", color: "#facc15", valueFor: (y: ProjectionYear) => y.portfolioAssets.taxableTotal },
  { label: "Retirement", color: "#f97316", valueFor: (y: ProjectionYear) => y.portfolioAssets.retirementTotal },
  { label: "Life Insurance", color: "#16a34a", valueFor: (y: ProjectionYear) => y.portfolioAssets.lifeInsuranceTotal },
  { label: "Real Estate", color: "#0891b2", valueFor: (y: ProjectionYear) => y.portfolioAssets.realEstateTotal },
  { label: "Business", color: "#7c3aed", valueFor: (y: ProjectionYear) => y.portfolioAssets.businessTotal },
  { label: "Trusts & Businesses", color: "#2563eb", valueFor: (y: ProjectionYear) => y.portfolioAssets.trustsAndBusinessesTotal },
  { label: "Accessible Trust Assets", color: "#99f6e4", valueFor: (y: ProjectionYear) => y.portfolioAssets.accessibleTrustAssetsTotal },
];

function portfolioTotalForYear(y: ProjectionYear): number {
  const pa = y.portfolioAssets as unknown as {
    total?: number;
    taxableTotal?: number;
    cashTotal?: number;
    retirementTotal?: number;
    lifeInsuranceTotal?: number;
  };
  if (typeof pa?.total === "number") return pa.total;
  return (
    (pa?.taxableTotal ?? 0) +
    (pa?.cashTotal ?? 0) +
    (pa?.retirementTotal ?? 0) +
    (pa?.lifeInsuranceTotal ?? 0)
  );
}

interface Props {
  plans: ComparisonPlan[];
}

function PlanBarChart({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const years = plan.result.years;
  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: PORTFOLIO_SERIES.map((s) => ({
        label: s.label,
        data: years.map(s.valueFor),
        backgroundColor: s.color,
        stack: "portfolio",
      })),
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

function TwoPlanDeltaChart({ plans }: { plans: [ComparisonPlan, ComparisonPlan] }) {
  const [base, scenario] = plans;
  const data = useMemo(() => {
    const baseByYear = new Map<number, number>(
      base.result.years.map((y) => [y.year, portfolioTotalForYear(y)]),
    );
    const scenarioByYear = new Map<number, number>(
      scenario.result.years.map((y) => [y.year, portfolioTotalForYear(y)]),
    );
    const allYears = Array.from(
      new Set([...baseByYear.keys(), ...scenarioByYear.keys()]),
    ).sort((a, b) => a - b);
    return {
      labels: allYears.map(String),
      datasets: [
        {
          label: "Common floor",
          data: allYears.map((yr) => {
            const b = baseByYear.get(yr) ?? scenarioByYear.get(yr) ?? 0;
            const s = scenarioByYear.get(yr) ?? baseByYear.get(yr) ?? 0;
            return Math.min(b, s);
          }),
          backgroundColor: "#2563eb",
          stack: "portfolio",
        },
        {
          label: `${scenario.label} ahead`,
          data: allYears.map((yr) => {
            const b = baseByYear.get(yr) ?? scenarioByYear.get(yr) ?? 0;
            const s = scenarioByYear.get(yr) ?? baseByYear.get(yr) ?? 0;
            return Math.max(0, s - b);
          }),
          backgroundColor: "#059669",
          stack: "portfolio",
        },
        {
          label: `${base.label} ahead`,
          data: allYears.map((yr) => {
            const b = baseByYear.get(yr) ?? scenarioByYear.get(yr) ?? 0;
            const s = scenarioByYear.get(yr) ?? baseByYear.get(yr) ?? 0;
            return Math.max(0, b - s);
          }),
          backgroundColor: "#9ca3af",
          stack: "portfolio",
        },
      ],
    };
  }, [base, scenario]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: "#d1d5db", boxWidth: 12, padding: 12 },
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

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div style={{ height: 320 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}

export function PortfolioComparisonSection({ plans }: Props) {
  if (plans.length >= 3) {
    return (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Portfolio Assets</h2>
        <PortfolioOverlayChart
          plans={plans.map((p) => ({ label: p.label, years: p.result.years }))}
        />
      </section>
    );
  }

  if (plans.length === 2) {
    return (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Portfolio Assets</h2>
        <TwoPlanDeltaChart plans={[plans[0], plans[1]]} />
      </section>
    );
  }

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Portfolio Assets</h2>
      <div className="grid grid-cols-1 gap-4">
        {plans.map((p, i) => (
          <PlanBarChart key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
