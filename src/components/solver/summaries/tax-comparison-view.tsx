// src/components/solver/summaries/tax-comparison-view.tsx
"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  LineController,
  BarController,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import type {
  TaxComparisonPageData,
  TaxComparisonKpi,
  CompositionComparison,
} from "@/lib/presentations/pages/tax-comparison/view-model";
import { fmtUsd } from "@/lib/presentations/pages/tax-summary/aggregate";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import {
  SummaryLayout,
  SummarySection,
  SummaryKpiRow,
  SummaryTable,
  SummaryNarrative,
  SummaryEmpty,
} from "./primitives";

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  LineController, BarController, Tooltip, Legend,
);

const dirClass = (d: 1 | -1 | 0) => (d === 1 ? "text-good" : d === -1 ? "text-crit" : "text-ink-3");

/** Comparison KPI: same metric for both plans + a signed, direction-colored delta. */
function ComparisonKpiCard({ kpi }: { kpi: TaxComparisonKpi }) {
  if (!kpi.show) return null;
  return (
    <div className="min-w-[150px] flex-1 rounded-lg border border-hair bg-card-2 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{kpi.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold text-ink">{kpi.scenario}</span>
        <span className={`text-[12px] font-medium ${dirClass(kpi.direction)}`}>{kpi.delta}</span>
      </div>
      <div className="text-[11px] text-ink-3">Base {kpi.base}</div>
    </div>
  );
}

// ── Scenario tax stacks + Base total overlay line ────────────────────────────
const SERIES: { label: string; key: "federalOrdinary" | "capGains" | "state"; colorKey: "blue" | "orange" | "teal" }[] = [
  { label: "Federal", key: "federalOrdinary", colorKey: "blue" },
  { label: "Capital gains", key: "capGains", colorKey: "orange" },
  { label: "State", key: "state", colorKey: "teal" },
];

function TaxComparisonChart({ chart }: { chart: TaxComparisonPageData["chart"] }) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (chart.length === 0) return null;
    const palette = dataPalette(theme);
    return {
      labels: chart.map((c) => String(c.year)),
      datasets: [
        ...SERIES.map((s) => ({
          type: "bar" as const,
          label: s.label,
          data: chart.map((c) => c[s.key]),
          backgroundColor: palette[s.colorKey],
          stack: "tax",
        })),
        {
          type: "line" as const,
          label: "Base total",
          data: chart.map((c) => c.baseTotal),
          borderColor: palette.grey,
          borderDash: [4, 3],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }, [chart, theme]);

  const options = useMemo<ChartOptions<"bar">>(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: chrome.legend, boxWidth: 12, padding: 16 } },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtUsd(Number(ctx.parsed.y ?? 0))}` },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: { stacked: true, ticks: { color: chrome.tick, callback: (v: unknown) => fmtUsd(Number(v)) }, grid: { color: chrome.grid } },
      },
    };
  }, [theme]);

  if (!chartData) return null;
  return (
    <div className="h-[280px]">
      <Chart type="bar" data={chartData as ChartData<"bar">} options={options} />
    </div>
  );
}

// ── Composition at retirement: Base vs Proposed, per tax treatment ───────────
const COMP_ROWS: { key: "roth" | "preTax" | "taxable"; label: string }[] = [
  { key: "roth", label: "Roth" },
  { key: "preTax", label: "Pre-tax" },
  { key: "taxable", label: "Taxable" },
];

function CompositionComparisonTable({ composition }: { composition: CompositionComparison }) {
  return (
    <SummaryTable
      columns={[
        { key: "label", header: "Account type" },
        { key: "base", header: "Base", align: "right" },
        { key: "scenario", header: "Proposed", align: "right" },
      ]}
      rows={[
        ...COMP_ROWS.map((r) => ({
          label: r.label,
          base: fmtUsd(composition.base[r.key]),
          scenario: fmtUsd(composition.scenario[r.key]),
        })),
        {
          label: <span className="font-semibold text-ink">Total</span>,
          base: <span className="font-semibold text-ink">{fmtUsd(composition.base.total)}</span>,
          scenario: <span className="font-semibold text-ink">{fmtUsd(composition.scenario.total)}</span>,
        },
      ]}
    />
  );
}

export function TaxComparisonView({ data }: { data: TaxComparisonPageData }) {
  if (data.isEmpty) return <SummaryEmpty message="No scenario to compare yet. Make an edit to see Base vs Proposed." />;

  return (
    <SummaryLayout title={data.title} subtitle={data.subtitle}>
      <SummaryKpiRow>
        {data.kpis.map((k) => <ComparisonKpiCard key={k.label} kpi={k} />)}
      </SummaryKpiRow>

      <SummarySection heading="Taxes paid by year (Proposed vs Base total)">
        <div className="rounded-lg border border-hair bg-card-2 p-4">
          <TaxComparisonChart chart={data.chart} />
        </div>
      </SummarySection>

      {data.bracket ? (
        <SummarySection heading="Bracket exposure">
          <SummaryTable
            columns={[
              { key: "label", header: "Measure" },
              { key: "base", header: "Base", align: "right" },
              { key: "scenario", header: "Proposed", align: "right" },
              { key: "delta", header: "Δ", align: "right" },
            ]}
            rows={data.bracket.map((b) => ({ label: b.label, base: b.base, scenario: b.scenario, delta: b.delta }))}
          />
        </SummarySection>
      ) : null}

      {data.composition ? (
        <SummarySection heading={`Accounts at retirement (${data.composition.year})`}>
          <CompositionComparisonTable composition={data.composition} />
        </SummarySection>
      ) : null}

      <SummaryNarrative items={data.narrative} />
    </SummaryLayout>
  );
}
