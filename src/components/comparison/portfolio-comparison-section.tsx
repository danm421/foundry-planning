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
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import { data } from "@/brand";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// Portfolio Assets = liquid investable buckets only. Real estate, business,
// and entity/trust-owned shares live on the balance sheet, not here.
const PORTFOLIO_SERIES: Array<{
  label: string;
  hue: keyof typeof data;
  valueFor: (y: ProjectionYear) => number;
}> = [
  { label: "Cash",          hue: "teal",   valueFor: (y) => y.portfolioAssets.cashTotal },
  { label: "Taxable",       hue: "yellow", valueFor: (y) => y.portfolioAssets.taxableTotal },
  { label: "Retirement",    hue: "orange", valueFor: (y) => y.portfolioAssets.retirementTotal },
  { label: "Life Insurance", hue: "green", valueFor: (y) => y.portfolioAssets.lifeInsuranceTotal },
];

function portfolioTotalForYear(y: ProjectionYear): number {
  const pa = y.portfolioAssets as unknown as {
    taxableTotal?: number;
    cashTotal?: number;
    retirementTotal?: number;
    lifeInsuranceTotal?: number;
  };
  return (
    (pa?.cashTotal ?? 0) +
    (pa?.taxableTotal ?? 0) +
    (pa?.retirementTotal ?? 0) +
    (pa?.lifeInsuranceTotal ?? 0)
  );
}

interface Props {
  plans: ComparisonPlan[];
}

function PlanBarChart({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const years = plan.result.years;
  const theme = useThemeName();
  const palette = dataPalette(theme);
  const data_ = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: PORTFOLIO_SERIES.map((s) => ({
        label: s.label,
        data: years.map(s.valueFor),
        backgroundColor: palette[s.hue],
        stack: "portfolio",
      })),
    }),
    [years, palette],
  );
  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: chrome.legend, boxWidth: 10, padding: 8, font: { size: 10 } },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
      },
    };
  }, [theme]);
  const color = seriesColor(index) ?? chartChrome(theme).tick;
  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-ink-3">{plan.label}</span>
      </div>
      <div style={{ height: 240 }}>
        <Bar data={data_} options={options} />
      </div>
    </div>
  );
}

function TwoPlanDeltaChart({ plans }: { plans: [ComparisonPlan, ComparisonPlan] }) {
  const [base, scenario] = plans;
  const theme = useThemeName();
  const palette = dataPalette(theme);
  const data_ = useMemo(() => {
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
          backgroundColor: palette.blue,
          stack: "portfolio",
        },
        {
          label: `${scenario.label} ahead`,
          data: allYears.map((yr) => {
            const b = baseByYear.get(yr) ?? scenarioByYear.get(yr) ?? 0;
            const s = scenarioByYear.get(yr) ?? baseByYear.get(yr) ?? 0;
            return Math.max(0, s - b);
          }),
          backgroundColor: palette.green,
          stack: "portfolio",
        },
        {
          label: `${base.label} ahead`,
          data: allYears.map((yr) => {
            const b = baseByYear.get(yr) ?? scenarioByYear.get(yr) ?? 0;
            const s = scenarioByYear.get(yr) ?? baseByYear.get(yr) ?? 0;
            return Math.max(0, b - s);
          }),
          backgroundColor: palette.grey,
          stack: "portfolio",
        },
      ],
    };
  }, [base, scenario, palette]);

  const options = useMemo(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: chrome.legend, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
      },
    };
  }, [theme]);

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div style={{ height: 320 }}>
        <Bar data={data_} options={options} />
      </div>
    </div>
  );
}

export function PortfolioComparisonSection({ plans }: Props) {
  if (plans.length >= 3) {
    return (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-ink">Portfolio Assets</h2>
        <PortfolioOverlayChart
          plans={plans.map((p) => ({ label: p.label, years: p.result.years }))}
        />
      </section>
    );
  }

  if (plans.length === 2) {
    return (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-ink">Portfolio Assets</h2>
        <TwoPlanDeltaChart plans={[plans[0], plans[1]]} />
      </section>
    );
  }

  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-ink">Portfolio Assets</h2>
      <div className="grid grid-cols-1 gap-4">
        {plans.map((p, i) => (
          <PlanBarChart key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
