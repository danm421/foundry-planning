"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { TaxSummaryPageData } from "@/lib/presentations/pages/tax-summary/view-model";
import { fmtUsd, fmtPct } from "@/lib/presentations/pages/tax-summary/aggregate";
import type { TaxYearBar } from "@/lib/presentations/pages/tax-summary/aggregate";
import { chartChrome, dataPalette, useThemeName } from "@/lib/chart-colors";
import {
  SummaryLayout,
  SummarySection,
  SummaryKpiRow,
  SummaryKpiCard,
  SummaryTable,
  SummaryNarrative,
  SummaryEmpty,
} from "./primitives";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ── Stacked "Taxes paid by year" chart ───────────────────────────────────────
const SERIES: { label: string; key: keyof Pick<TaxYearBar, "federalOrdinary" | "state" | "capGains">; colorKey: "blue" | "teal" | "orange" }[] = [
  { label: "Federal", key: "federalOrdinary", colorKey: "blue" },
  { label: "State", key: "state", colorKey: "teal" },
  { label: "Capital gains", key: "capGains", colorKey: "orange" },
];

function TaxYearsChart({ bars }: { bars: TaxYearBar[] }) {
  const theme = useThemeName();

  const chartData = useMemo(() => {
    if (bars.length === 0) return null;
    const palette = dataPalette(theme);
    return {
      labels: bars.map((b) => String(b.year)),
      datasets: SERIES.map((s) => ({
        label: s.label,
        data: bars.map((b) => b[s.key]),
        backgroundColor: palette[s.colorKey],
        stack: "tax",
      })),
    };
  }, [bars, theme]);

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
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtUsd(Number(ctx.parsed.y ?? 0))}`,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: {
          stacked: true,
          ticks: { color: chrome.tick, callback: (v: unknown) => fmtUsd(Number(v)) },
          grid: { color: chrome.grid },
        },
      },
    };
  }, [theme]);

  if (!chartData) return null;
  return (
    <div className="h-[280px]">
      <Bar data={chartData} options={options} />
    </div>
  );
}

// ── Account composition split bar ────────────────────────────────────────────
const COMP_SEGMENTS = [
  { key: "roth" as const, label: "Roth", colorKey: "green" as const },
  { key: "preTax" as const, label: "Pre-tax", colorKey: "red" as const },
  { key: "taxable" as const, label: "Taxable", colorKey: "grey" as const },
];

function CompositionBar({
  composition,
  theme,
}: {
  composition: NonNullable<TaxSummaryPageData["composition"]>;
  theme: ReturnType<typeof useThemeName>;
}) {
  const palette = dataPalette(theme);
  const total = composition.total;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-4 overflow-hidden rounded">
        {COMP_SEGMENTS.map((seg) => {
          const v = composition[seg.key];
          const pct = total > 0 ? (v / total) * 100 : 0;
          if (pct <= 0) return null;
          return <div key={seg.key} style={{ width: `${pct}%`, backgroundColor: palette[seg.colorKey] }} />;
        })}
      </div>
      <SummaryTable
        columns={[
          { key: "label", header: "Account type" },
          { key: "pct", header: "Share", align: "right" },
          { key: "amount", header: "Balance", align: "right" },
        ]}
        rows={[
          ...COMP_SEGMENTS.map((seg) => {
            const v = composition[seg.key];
            const pct = total > 0 ? Math.round((v / total) * 100) : 0;
            return {
              label: (
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: palette[seg.colorKey] }}
                  />
                  {seg.label}
                </span>
              ),
              pct: `${pct}%`,
              amount: fmtUsd(v),
            };
          }),
          { label: <span className="font-semibold text-ink">Total</span>, pct: "", amount: <span className="font-semibold text-ink">{fmtUsd(total)}</span> },
        ]}
      />
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────
export function TaxSummaryView({ data }: { data: TaxSummaryPageData }) {
  const theme = useThemeName();
  if (data.isEmpty) return <SummaryEmpty message="No data for this scenario yet." />;

  const { bracket, composition } = data;

  return (
    <SummaryLayout title={data.title} subtitle={data.subtitle}>
      <SummaryKpiRow>
        <SummaryKpiCard label="Lifetime Federal Tax" value={fmtUsd(data.kpis.lifetimeFederal)} />
        <SummaryKpiCard label="Lifetime State Tax" value={fmtUsd(data.kpis.lifetimeState)} />
        <SummaryKpiCard label="Lifetime Capital Gains Tax" value={fmtUsd(data.kpis.lifetimeCapGains)} />
        <SummaryKpiCard label="Lifetime Total Tax" value={fmtUsd(data.kpis.lifetimeTotal)} />
        <SummaryKpiCard label="Lifetime Effective Rate" value={fmtPct(data.kpis.effectiveRate)} />
      </SummaryKpiRow>

      <SummarySection heading="Taxes paid by year">
        <div className="rounded-lg border border-hair bg-card-2 p-4">
          <TaxYearsChart bars={data.chart} />
        </div>
      </SummarySection>

      {bracket ? (
        <SummarySection heading="Bracket exposure">
          <SummaryTable
            columns={[
              { key: "label", header: "Measure" },
              { key: "value", header: "", align: "right" },
            ]}
            rows={[
              { label: `Years below the ${fmtPct(bracket.lowThreshold)} bracket`, value: String(bracket.yearsBelowLow) },
              { label: `Years above the ${fmtPct(bracket.highThreshold)} bracket`, value: String(bracket.yearsAboveHigh) },
              ...(bracket.minRate != null && bracket.maxRate != null
                ? [{ label: "Marginal rate range", value: `${fmtPct(bracket.minRate)} – ${fmtPct(bracket.maxRate)}` }]
                : []),
            ]}
          />
        </SummarySection>
      ) : null}

      {composition && composition.total > 0 ? (
        <SummarySection heading="Accounts at retirement">
          <p className="text-[13px] text-ink-3">Account composition at retirement ({composition.year})</p>
          <CompositionBar composition={composition} theme={theme} />
        </SummarySection>
      ) : null}

      <SummaryNarrative items={data.narrative} />
    </SummaryLayout>
  );
}
