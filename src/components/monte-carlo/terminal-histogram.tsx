"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { buildHistogramSeries } from "./lib/terminal-histogram-series";
import { formatShortCurrency, formatInteger, formatPercent } from "./lib/format";
import { PromoteButton } from "./promote-button";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface BinRange {
  min: number;
  max: number;
}

// Convert a raw value to an x-pixel using the histogram's category scale.
// Locates the bin the value falls in, then linearly interpolates within it
// using the value's position in [bin.min, bin.max). Values below/above the
// chart domain are clamped to the first/last bin's outer edge.
function valueToPixel(
  value: number,
  bins: BinRange[],
  scaleX: { getPixelForValue(v: number): number },
): number {
  if (bins.length === 0) return 0;
  let idx = bins.findIndex((b) => value >= b.min && value < b.max);
  if (idx < 0) {
    if (value < bins[0].min) idx = 0;
    else idx = bins.length - 1;
  }
  const center = scaleX.getPixelForValue(idx);
  const neighbor = idx + 1 < bins.length
    ? scaleX.getPixelForValue(idx + 1)
    : scaleX.getPixelForValue(idx - 1);
  const halfWidth = Math.abs(neighbor - center) / 2;
  const bin = bins[idx];
  const span = bin.max - bin.min;
  const frac = span > 0 ? (value - bin.min) / span : 0.5;
  // Clamp the fractional offset so off-domain values pin to the bin edge.
  const clamped = Math.max(0, Math.min(1, frac));
  return center - halfWidth + clamped * 2 * halfWidth;
}

interface PercentileMarkerOptions {
  bins: BinRange[];
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
}

// Renders the empirical distribution shape behind the bars: a faint outer
// band covering P5–P95 (90% of trials), a more visible inner band covering
// P25–P75 (the IQR — middle 50%), and a solid median line. Percentile-based
// markers describe the actual distribution rather than implying a normal
// shape, which matters here because compounded portfolio returns are heavily
// right-skewed.
const percentileBandsPlugin = {
  id: "pctBands",
  beforeDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number; left: number; right: number };
      scales: { x: { getPixelForValue(v: number): number } };
    },
    _args: unknown,
    options: PercentileMarkerOptions | undefined,
  ) {
    // This plugin is registered globally, so it fires on every Chart.js chart
    // in the app. Bail out if any required option is missing — only the
    // terminal-histogram chart configures `pctBands`, so for FanChart and
    // LongevityChart this guard ensures we no-op cleanly instead of crashing.
    if (!options || !Array.isArray(options.bins) || options.bins.length === 0) return;
    if (!Number.isFinite(options.median)) return;
    const { ctx, chartArea, scales } = chart;
    const { bins, p5, p25, median, p75, p95 } = options;

    const xP5 = valueToPixel(p5, bins, scales.x);
    const xP25 = valueToPixel(p25, bins, scales.x);
    const xP50 = valueToPixel(median, bins, scales.x);
    const xP75 = valueToPixel(p75, bins, scales.x);
    const xP95 = valueToPixel(p95, bins, scales.x);

    const top = chartArea.top;
    const height = chartArea.bottom - chartArea.top;

    ctx.save();
    // Outer band P5–P25 and P75–P95 — very faint
    ctx.fillStyle = "rgba(110, 231, 183, 0.06)";
    ctx.fillRect(xP5, top, xP25 - xP5, height);
    ctx.fillRect(xP75, top, xP95 - xP75, height);
    // Inner band P25–P75 (IQR) — slightly more visible
    ctx.fillStyle = "rgba(110, 231, 183, 0.12)";
    ctx.fillRect(xP25, top, xP75 - xP25, height);

    // Boundary verticals
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
    for (const x of [xP5, xP25, xP75, xP95]) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    // Median line — solid, more prominent
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(226, 232, 240, 0.7)";
    ctx.beginPath();
    ctx.moveTo(xP50, top);
    ctx.lineTo(xP50, chartArea.bottom);
    ctx.stroke();

    // Percentile labels above the bars. When the distribution is heavily
    // right-skewed the inner labels (25th / Median / 75th) cluster on the
    // left; that visual crowding itself communicates the skew.
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgb(148, 163, 184)";
    const labelY = top - 2;
    ctx.fillText("5th", xP5, labelY);
    ctx.fillText("25th", xP25, labelY);
    ctx.fillStyle = "rgb(226, 232, 240)";
    ctx.fillText("Median", xP50, labelY);
    ctx.fillStyle = "rgb(148, 163, 184)";
    ctx.fillText("75th", xP75, labelY);
    ctx.fillText("95th", xP95, labelY);

    ctx.restore();
  },
};

ChartJS.register(percentileBandsPlugin);

const ZONE_FAILED = "rgba(244, 63, 94, 0.85)"; // rose-500
const ZONE_DEPLETED = "rgba(251, 146, 60, 0.85)"; // orange-400
const ZONE_PRESERVED = "rgba(52, 211, 153, 0.85)"; // emerald-400

function classifyBin(
  binMidpoint: number,
  threshold: number,
  startingBalance: number | undefined,
): "failed" | "depleted" | "preserved" {
  if (binMidpoint < threshold) return "failed";
  if (startingBalance != null && binMidpoint < startingBalance) return "depleted";
  return "preserved";
}

interface TerminalHistogramProps {
  endingValues: number[];
  trialsRun: number;
  /** Failure threshold — bars below this are colored as a "ran out" zone. */
  requiredMinimumAssetLevel?: number;
  /** Plan-start liquid balance — bars below this but above threshold are colored
   *  as a "depleted" zone. Omit to suppress the amber zone. */
  startingLiquidBalance?: number;
  variant?: "main" | "compact";
  onPromote?: () => void;
}

export function TerminalHistogram({
  endingValues,
  trialsRun,
  requiredMinimumAssetLevel = 0,
  startingLiquidBalance,
  variant = "compact",
  onPromote,
}: TerminalHistogramProps) {
  const isMain = variant === "main";
  const series = useMemo(() => buildHistogramSeries(endingValues), [endingValues]);

  const failedCount = useMemo(
    () => endingValues.reduce((n, v) => (v <= requiredMinimumAssetLevel ? n + 1 : n), 0),
    [endingValues, requiredMinimumAssetLevel],
  );

  if (series.bins.length === 0) {
    return (
      <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Ending Portfolio Distribution</h3>
        <p className="text-sm text-slate-400">No trial data available.</p>
      </section>
    );
  }

  const failureRate = trialsRun > 0 ? failedCount / trialsRun : 0;
  const sd = series.sd;

  const data = {
    labels: series.bins.map((b) => formatShortCurrency(b.max)),
    datasets: [
      {
        label: "Count",
        data: series.bins.map((b) => b.count),
        backgroundColor: series.bins.map((b) => {
          const mid = (b.min + b.max) / 2;
          const zone = classifyBin(mid, requiredMinimumAssetLevel, startingLiquidBalance);
          if (zone === "failed") return ZONE_FAILED;
          if (zone === "depleted") return ZONE_DEPLETED;
          return ZONE_PRESERVED;
        }),
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 0.96,
      },
    ],
  };

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 18 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.92)",
        titleColor: "rgb(226, 232, 240)",
        bodyColor: "rgb(203, 213, 225)",
        callbacks: {
          title: (items: Array<{ dataIndex: number }>) => {
            const b = series.bins[items[0]?.dataIndex ?? 0];
            return `${formatShortCurrency(b.min)} – ${formatShortCurrency(b.max)}`;
          },
          label: (ctx: { parsed: { y: number | null } }): string | void => {
            const count = ctx.parsed.y ?? 0;
            const pct = trialsRun > 0 ? count / trialsRun : 0;
            return `${count} trials (${formatPercent(pct)})`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: "rgb(148, 163, 184)",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: isMain ? 8 : 5,
          font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: "rgba(148, 163, 184, 0.08)" },
        ticks: {
          color: "rgb(148, 163, 184)",
          font: { size: 10 },
          maxTicksLimit: 4,
          callback: (v: number | string) => {
            const n = typeof v === "string" ? parseFloat(v) : v;
            return Number.isInteger(n) ? formatInteger(n) : "";
          },
        },
        title: isMain
          ? { display: true, text: "Trials", color: "rgb(148, 163, 184)", font: { size: 10 } }
          : { display: false },
      },
    },
  } satisfies ChartOptions<"bar">;

  const options = {
    ...baseOptions,
    plugins: {
      ...baseOptions.plugins,
      pctBands: {
        bins: series.bins,
        p5: series.p5,
        p25: series.p25,
        median: series.p50,
        p75: series.p75,
        p95: series.p95,
      },
    },
  } as ChartOptions<"bar">;

  const showZoneLegend =
    startingLiquidBalance != null && startingLiquidBalance > requiredMinimumAssetLevel;

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <h3
          className={
            isMain
              ? "text-base font-semibold text-slate-100"
              : "text-sm font-semibold text-slate-100"
          }
        >
          Ending Portfolio Distribution
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">N = {formatInteger(trialsRun)}</span>
          {!isMain && onPromote && <PromoteButton onPromote={onPromote} />}
        </div>
      </div>

      {isMain ? (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <Stat label="Median" value={formatShortCurrency(series.p50)} tone="slate" />
            <Stat
              label="Inner 50% (P25–P75)"
              value={`${formatShortCurrency(series.p25)} – ${formatShortCurrency(series.p75)}`}
              sub="50% of trials"
              tone="emerald"
            />
            <Stat
              label="Inner 90% (P5–P95)"
              value={`${formatShortCurrency(series.p5)} – ${formatShortCurrency(series.p95)}`}
              sub="90% of trials"
              tone="emerald"
            />
            <Stat
              label="Ran out of money"
              value={formatPercent(failureRate)}
              sub={`${formatInteger(failedCount)} of ${formatInteger(trialsRun)}`}
              tone={failureRate > 0.1 ? "rose" : failureRate > 0.05 ? "amber" : "emerald"}
            />
          </div>
          <div className="text-[11px] text-slate-500 mb-1 tabular-nums">
            Mean {formatShortCurrency(sd.mean)}
            <span className="mx-1.5 text-slate-700">·</span>
            σ {formatShortCurrency(sd.stdDev)}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400 mb-2 tabular-nums">
          <span className="text-slate-200">Median {formatShortCurrency(series.p50)}</span>
          <span className="mx-1.5 text-slate-600">·</span>
          <span>
            P25–P75 {formatShortCurrency(series.p25)}–{formatShortCurrency(series.p75)}
          </span>
        </p>
      )}

      <div className={isMain ? "h-[360px]" : "h-[220px]"}>
        <Bar data={data} options={options} />
      </div>

      {(series.belowDomainCount > 0 || series.aboveDomainCount > 0) && (
        <p className="text-[11px] text-slate-500 mt-2 text-center">
          {series.belowDomainCount > 0 && (
            <span>
              ← {formatInteger(series.belowDomainCount)} trial
              {series.belowDomainCount === 1 ? "" : "s"} below shown range
            </span>
          )}
          {series.belowDomainCount > 0 && series.aboveDomainCount > 0 && (
            <span className="mx-2">·</span>
          )}
          {series.aboveDomainCount > 0 && (
            <span>
              {formatInteger(series.aboveDomainCount)} trial
              {series.aboveDomainCount === 1 ? "" : "s"} above shown range →
            </span>
          )}
        </p>
      )}

      {isMain && showZoneLegend && (
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-400">
          <LegendChip color={ZONE_FAILED} label={`Below minimum (${formatShortCurrency(requiredMinimumAssetLevel)})`} />
          <LegendChip color={ZONE_DEPLETED} label={`Below starting (${formatShortCurrency(startingLiquidBalance!)})`} />
          <LegendChip color={ZONE_PRESERVED} label="Preserved or grown" />
        </div>
      )}
    </section>
  );
}

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  tone: "rose" | "amber" | "slate" | "emerald";
}

function Stat({ label, value, sub, tone }: StatProps) {
  const toneClass = {
    rose: "text-rose-300",
    amber: "text-amber-300",
    slate: "text-slate-100",
    emerald: "text-emerald-300",
  }[tone];
  return (
    <div className="rounded-md bg-slate-950/40 ring-1 ring-slate-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 tabular-nums">{sub}</div>}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}
