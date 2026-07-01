// src/components/solver/summaries/retirement-comparison-view.tsx
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
  type ChartOptions,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import type {
  RetirementComparisonPageData,
  KpiCard as KpiCardData,
  OverlayBar,
  ConfidencePoint,
  TaxTreatmentBreakdown,
} from "@/lib/presentations/pages/retirement-comparison/types";
import { fmtUsdCompact } from "@/lib/presentations/pages/retirement-comparison/format";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import { SummaryLayout, SummarySection, SummaryKpiRow, SummaryTable, SummaryEmpty } from "./primitives";

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  LineController, BarController, Tooltip, Legend,
);

function ComparisonKpiCard({ kpi }: { kpi: KpiCardData }) {
  if (!kpi.show) return null;
  return (
    <div className="min-w-[150px] flex-1 rounded-lg border border-hair bg-card-2 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{kpi.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold text-ink">{kpi.scenario}</span>
        {kpi.delta ? <span className="text-[12px] font-medium text-good">{kpi.delta}</span> : null}
      </div>
      <div className="text-[11px] text-ink-3">Base {kpi.base}</div>
    </div>
  );
}

// ── Portfolio overlay: floor + who's ahead, per year (stacked bars) ──────────
function OverlayChart({ overlay }: { overlay: OverlayBar[] }) {
  const theme = useThemeName();
  const chartData = useMemo(() => {
    if (overlay.length === 0) return null;
    const palette = dataPalette(theme);
    return {
      labels: overlay.map((o) => String(o.year)),
      datasets: [
        { label: "Shared", data: overlay.map((o) => o.floor), backgroundColor: palette.blue, stack: "p" },
        { label: "Proposed ahead", data: overlay.map((o) => o.scenarioAhead), backgroundColor: palette.green, stack: "p" },
        { label: "Base ahead", data: overlay.map((o) => o.baseAhead), backgroundColor: palette.grey, stack: "p" },
      ],
    };
  }, [overlay, theme]);
  const options = useMemo<ChartOptions<"bar">>(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: chrome.legend, boxWidth: 12, padding: 16 } },
        tooltip: {
          backgroundColor: chrome.tooltipBg, titleColor: chrome.tooltipTitle, bodyColor: chrome.tooltipBody,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtUsdCompact(Number(ctx.parsed.y ?? 0))}` },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: { stacked: true, ticks: { color: chrome.tick, callback: (v: unknown) => fmtUsdCompact(Number(v)) }, grid: { color: chrome.grid } },
      },
    };
  }, [theme]);
  if (!chartData) return null;
  return <div className="h-[280px]"><Bar data={chartData} options={options} /></div>;
}

// ── Confidence range: Base vs Proposed median + downside/upside lines ─────────
function ConfidenceChart({ points }: { points: ConfidencePoint[] }) {
  const theme = useThemeName();
  const chartData = useMemo(() => {
    if (points.length === 0) return null;
    const palette = dataPalette(theme);
    const line = (label: string, pick: (p: ConfidencePoint) => number, color: string, dash?: number[]) => ({
      label, data: points.map(pick), borderColor: color, borderDash: dash, borderWidth: 1.5, pointRadius: 0, fill: false,
    });
    return {
      labels: points.map((p) => String(p.year)),
      datasets: [
        line("Proposed (median)", (p) => p.scnP50, palette.green),
        line("Base (median)", (p) => p.baseP50, palette.grey),
        line("Proposed (downside)", (p) => p.scnP20, palette.green, [4, 3]),
        line("Proposed (upside)", (p) => p.scnP80, palette.green, [4, 3]),
      ],
    };
  }, [points, theme]);
  const options = useMemo<ChartOptions<"line">>(() => {
    const chrome = chartChrome(theme);
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: chrome.legend, boxWidth: 12, padding: 16 } },
        tooltip: { backgroundColor: chrome.tooltipBg, titleColor: chrome.tooltipTitle, bodyColor: chrome.tooltipBody },
      },
      scales: {
        x: { ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: { ticks: { color: chrome.tick, callback: (v: unknown) => fmtUsdCompact(Number(v)) }, grid: { color: chrome.grid } },
      },
    };
  }, [theme]);
  if (!chartData) return null;
  return <div className="h-[280px]"><Line data={chartData} options={options} /></div>;
}

// ── Assets by tax treatment at a horizon: Base vs Proposed ───────────────────
const BUCKETS: { key: "cash" | "taxable" | "preTax" | "roth" | "hsa"; label: string }[] = [
  { key: "roth", label: "Roth" },
  { key: "preTax", label: "Pre-tax" },
  { key: "taxable", label: "Taxable" },
  { key: "cash", label: "Cash" },
  { key: "hsa", label: "HSA" },
];

function TreatmentTable({ breakdown }: { breakdown: TaxTreatmentBreakdown }) {
  const rows = BUCKETS
    .filter((b) => breakdown.base[b.key] > 0 || breakdown.scenario[b.key] > 0)
    .map((b) => ({ label: b.label, base: fmtUsdCompact(breakdown.base[b.key]), scenario: fmtUsdCompact(breakdown.scenario[b.key]) }));
  if (rows.length === 0) return null;
  return (
    <SummaryTable
      columns={[
        { key: "label", header: "Treatment" },
        { key: "base", header: "Base", align: "right" },
        { key: "scenario", header: "Proposed", align: "right" },
      ]}
      rows={rows}
    />
  );
}

export function RetirementComparisonView({ data }: { data: RetirementComparisonPageData }) {
  if (data.isEmpty) return <SummaryEmpty message="Run the comparison to see Base Case vs your working plan." />;

  return (
    <SummaryLayout title={data.title} subtitle={data.subtitle}>
      {data.verdict.headline ? (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-medium text-ink">
          {data.verdict.headline}
        </div>
      ) : null}

      <SummaryKpiRow>
        {data.kpis.map((k) => <ComparisonKpiCard key={k.label} kpi={k} />)}
      </SummaryKpiRow>

      {data.overlay.length > 0 ? (
        <SummarySection heading="Portfolio: shared vs plan advantage over time">
          <div className="rounded-lg border border-hair bg-card-2 p-4"><OverlayChart overlay={data.overlay} /></div>
        </SummarySection>
      ) : null}

      {data.confidence.show ? (
        <SummarySection heading="Confidence range (Monte Carlo)">
          <div className="rounded-lg border border-hair bg-card-2 p-4"><ConfidenceChart points={data.confidence.points} /></div>
        </SummarySection>
      ) : null}

      <SummarySection heading={`Assets by tax treatment at retirement (${data.atRetirement.year})`}>
        <TreatmentTable breakdown={data.atRetirement} />
      </SummarySection>

      <SummarySection heading={`Assets by tax treatment at end of life (${data.atEndOfLife.year})`}>
        <TreatmentTable breakdown={data.atEndOfLife} />
      </SummarySection>
    </SummaryLayout>
  );
}
