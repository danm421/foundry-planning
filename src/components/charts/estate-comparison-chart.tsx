"use client";

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
import { useMemo, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { Ordering } from "@/lib/estate/yearly-estate-report";
import { buildEstateComparison } from "@/lib/estate/estate-comparison";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import { data as brandData, dataLight as brandDataLight } from "@/brand";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const BUCKET_LABELS = ["Total to Heirs", "Total Taxes & Expenses", "Total to Charity"];

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function fmtDelta(n: number): string {
  if (n === 0) return "—";
  const arrow = n > 0 ? "▲" : "▼";
  return `${arrow} ${n > 0 ? "+" : "−"}${fmtUsd(Math.abs(n))}`;
}

export interface EstateComparisonChartProps {
  baseProjection: ProjectionYear[];
  proposedProjection: ProjectionYear[];
  baseTree: ClientData;
  proposedTree: ClientData;
  isMarried: boolean;
  /** Year of the first spouse's death in the with-events projection, or null
   *  if unknown/unmarried. Once the viewing year reaches this year, the estate
   *  distribution is anchored to the actual death order, so the death-order
   *  toggle is hidden and the comparison is forced to "primaryFirst" (the
   *  anchored model ignores ordering, but this keeps the UI honest). */
  firstDeathYear: number | null;
}

export function EstateComparisonChart({
  baseProjection,
  proposedProjection,
  baseTree,
  proposedTree,
  isMarried,
  firstDeathYear,
}: EstateComparisonChartProps) {
  const theme = useThemeName();

  const years = proposedProjection
    .filter((y) => y.hypotheticalEstateTax)
    .map((y) => y.year);
  const minYear = years[0] ?? proposedProjection[0]?.year ?? 0;
  const maxYear = years[years.length - 1] ?? minYear;

  const [selectedYear, setSelectedYear] = useState(maxYear);
  const [prevMaxYear, setPrevMaxYear] = useState(maxYear);
  if (maxYear !== prevMaxYear) {
    setPrevMaxYear(maxYear);
    setSelectedYear(maxYear);
  }

  const [ordering, setOrdering] = useState<Ordering>("primaryFirst");

  // Once the viewing year reaches the first death, the estate distribution is
  // anchored to the actual death order — the toggle no longer applies.
  const toggleVisible =
    isMarried && (firstDeathYear == null || selectedYear < firstDeathYear);

  const c = proposedTree.client;

  const comparison = useMemo(
    () =>
      buildEstateComparison({
        baseProjection,
        proposedProjection,
        baseTree,
        proposedTree,
        ordering: toggleVisible ? ordering : "primaryFirst",
        year: selectedYear,
        ownerNames: {
          clientName: `${c.firstName} ${c.lastName}`.trim(),
          spouseName: c.spouseName ?? null,
        },
        ownerDobs: {
          clientDob: c.dateOfBirth,
          spouseDob: c.spouseDob ?? null,
        },
      }),
    [
      baseProjection,
      proposedProjection,
      baseTree,
      proposedTree,
      ordering,
      toggleVisible,
      selectedYear,
      c.firstName,
      c.lastName,
      c.spouseName,
      c.dateOfBirth,
      c.spouseDob,
    ],
  );

  const palette = theme === "light" ? brandDataLight : brandData;

  const chartData = useMemo(
    () => ({
      labels: BUCKET_LABELS,
      datasets: [
        {
          label: "Base Facts",
          data: [
            comparison.base.toHeirs,
            comparison.base.taxesAndExpenses,
            comparison.base.toCharity,
          ],
          backgroundColor: palette.grey,
        },
        {
          label: "Proposed Plan",
          data: [
            comparison.proposed.toHeirs,
            comparison.proposed.taxesAndExpenses,
            comparison.proposed.toCharity,
          ],
          backgroundColor: palette.blue,
        },
      ],
    }),
    [comparison, palette],
  );

  const chrome = chartChrome(theme);

  // Draws the formatted dollar amount above each bar. Mirrors the inline
  // afterDatasetsDraw plugins used by the other charts (e.g. portfolio-bars).
  const valueLabelsPlugin = useMemo(
    () => ({
      id: "estateBarValueLabels",
      afterDatasetsDraw(chart: ChartJS<"bar">) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = chrome.tick;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        chart.data.datasets.forEach((_dataset, i) => {
          const meta = chart.getDatasetMeta(i);
          if (meta.hidden) return;
          meta.data.forEach((bar, j) => {
            const value = Number(chart.data.datasets[i].data[j] ?? 0);
            if (!value) return;
            ctx.fillText(fmtUsd(value), bar.x, bar.y - 4);
          });
        });
        ctx.restore();
      },
    }),
    [chrome.tick],
  );

  const chartOptions: ChartOptions<"bar"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      // Headroom so the value labels drawn above the tallest bar aren't clipped.
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { position: "top" as const, align: "end" as const, labels: { color: chrome.legend } },
        tooltip: {
          backgroundColor: chrome.tooltipBg,
          titleColor: chrome.tooltipTitle,
          bodyColor: chrome.tooltipBody,
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${fmtUsd(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: chrome.tick }, grid: { color: chrome.grid } },
        y: {
          ticks: { color: chrome.tick, callback: (v: unknown) => fmtUsd(Number(v)) },
          grid: { color: chrome.grid },
        },
      },
    }),
    [chrome],
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-ink">
            Estate distribution if both die in{" "}
            <span className="text-accent">{selectedYear}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span>{minYear}</span>
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="w-40 accent-accent"
            aria-label="Death year"
          />
          <span>{maxYear}</span>
        </div>
      </div>

      {toggleVisible ? (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-ink-3">Death order:</span>
          {(["primaryFirst", "spouseFirst"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOrdering(o)}
              className={
                ordering === o
                  ? "rounded-full bg-accent px-2 py-0.5 text-white"
                  : "rounded-full bg-hair-2 px-2 py-0.5 text-ink-3 hover:text-ink"
              }
            >
              {o === "primaryFirst" ? "Client first" : "Spouse first"}
            </button>
          ))}
        </div>
      ) : null}

      {/* Flexes to fill the resizable panel rather than a fixed height, so the
          header/slider/toggle and the deltas grid below stay inside the panel
          instead of overflowing onto the page when the chart is shrunk. */}
      <div className="min-h-0 flex-1">
        <Bar data={chartData} options={chartOptions} plugins={[valueLabelsPlugin]} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["Total to Heirs", comparison.deltas.toHeirs, true],
            ["Total Taxes & Expenses", comparison.deltas.taxesAndExpenses, false],
            ["Total to Charity", comparison.deltas.toCharity, true],
          ] as const
        ).map(([label, delta, higherIsBetter]) => {
          const favorable =
            delta === 0 ? false : higherIsBetter ? delta > 0 : delta < 0;
          return (
            <div key={label}>
              <div className="text-[11px] font-medium text-ink-2">{label}</div>
              <div
                className={
                  delta === 0
                    ? "text-[11px] text-ink-3"
                    : favorable
                      ? "text-[11px] font-semibold text-good"
                      : "text-[11px] font-semibold text-crit"
                }
              >
                {fmtDelta(delta)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
