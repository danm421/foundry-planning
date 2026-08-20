"use client";
import type { ReactElement } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type ChartType,
  type Plugin,
} from "chart.js";
import { useThemeName, chartChrome, dataPalette } from "@/lib/chart-colors";
import { fmtUsd, fmtUsdCompact, fmtMonthLabel } from "@/lib/portal/format";
import {
  monthLabel,
  paydownChartIsEmpty,
  paydownChartPoints,
  type PaydownComparison,
} from "@/lib/calculators/debt-paydown";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip);

/**
 * Years between x-axis labels. A paydown can run anywhere from two years to
 * the fifty-year ceiling, so a fixed one-a-year rule draws four labels on one
 * chart and fifty overlapping ones on the next. Step up a 1/2/5 ladder until
 * at most eight labels remain, whatever the horizon.
 */
function yearTickStep(points: number): number {
  const spans = Math.max(1, points - 1);
  return (
    [1, 2, 5, 10, 25].find((step) => Math.floor(spans / (12 * step)) + 1 <= 8) ?? 50
  );
}

/**
 * The month the last dollar is paid, marked where the plan's line touches
 * zero — the pill mirrors `BudgetHistoryChart`'s budget line.
 *
 * Everything it draws arrives through `options.plugins.debtFreeMarker` rather
 * than through a closure, and the plugin itself is defined once at module
 * level. `react-chartjs-2` hands its `plugins` prop to the Chart constructor
 * and never again — a plugin closed over `chrome` or over the payoff index
 * keeps the values from first paint, so the pill would stay dark after a
 * switch to the light theme and stay put after the client changed their extra
 * payment. Options are re-assigned on every render, so these do not.
 */
interface DebtFreeMarkerOptions {
  /** Data index where the plan's balance reaches zero. Null draws nothing. */
  index: number | null;
  text: string;
  line: string;
  fill: string;
  stroke: string;
  ink: string;
}

declare module "chart.js" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    debtFreeMarker?: DebtFreeMarkerOptions;
  }
}

const debtFreeMarker: Plugin<"line"> = {
  id: "debtFreeMarker",
  afterDatasetsDraw(chart, _args, opts) {
    const o = opts as unknown as DebtFreeMarkerOptions | undefined;
    if (o?.index == null) return;
    const { top, bottom, left, right } = chart.chartArea;
    const x = chart.scales.x.getPixelForValue(o.index);
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = o.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.font = "600 10px ui-monospace, monospace";
    const padX = 5;
    const w = ctx.measureText(o.text).width + padX * 2;
    const h = 16;
    // Centred on the marker, then nudged back inside the plot area — the
    // payoff sits near the right edge whenever the baseline never clears.
    const px = Math.min(Math.max(x - w / 2, left), right - w);
    const py = top - h - 2;
    ctx.fillStyle = o.fill;
    ctx.strokeStyle = o.stroke;
    ctx.beginPath();
    ctx.roundRect(px, py, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = o.ink;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(o.text, px + padX, py + h / 2 + 0.5);
    ctx.restore();
  },
};

function LegendKey({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}): ReactElement {
  return (
    <span className="flex items-center gap-2 text-[12px] text-ink-3">
      <svg width="18" height="8" aria-hidden="true" className="shrink-0">
        <line
          x1="0"
          y1="4"
          x2="18"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

/**
 * What they owe over time: doing nothing against the plan.
 *
 * One point per month, so points are hidden and only every few years get a
 * label. Baseline is grey and dashed because it is the reference and should
 * recede; the plan is a solid blue. Neither is the accent: verdigris is for
 * action, never for data. The legend is DOM rather than canvas so it reads in
 * the app's own type and tokens — same call `BudgetDonut` makes.
 */
export function DebtPaydownChart({
  comparison,
  startYear,
  startMonth,
}: {
  comparison: PaydownComparison;
  startYear: number;
  startMonth: number;
}): ReactElement | null {
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  const pal = dataPalette(theme);

  const { baseline, plan, debtFreeMonth } = comparison;
  if (paydownChartIsEmpty(comparison)) return null;
  const length = paydownChartPoints(comparison);

  const labels = Array.from({ length }, (_, i) => monthLabel(startYear, startMonth, i + 1));
  // Truncates as well as pads: a baseline that never clears runs past the
  // window `paydownChartPoints` chose, and leaves the frame still climbing.
  const fit = (series: number[]): number[] =>
    Array.from({ length }, (_, i) => (i < series.length ? series[i] : 0));

  // Where the plan's line lands on zero. Null when it never does.
  const payoffIndex = plan.neverPaysOff ? null : plan.monthsToDebtFree;
  const tickStep = yearTickStep(length);

  const summary =
    debtFreeMonth && payoffIndex !== null
      ? `Total owed, month by month. Your plan clears ${fmtUsd(plan.balanceSeries[0])} by ${fmtMonthLabel(debtFreeMonth)}; paying only the minimums separately leaves ${fmtUsd(baseline.balanceSeries[payoffIndex] ?? 0)} still owing by then.`
      : `Total owed, month by month. Neither your plan nor the minimums clear the balance.`;

  const data = {
    labels,
    datasets: [
      {
        label: "Minimums, paid separately",
        data: fit(baseline.balanceSeries),
        borderColor: pal.grey,
        borderWidth: 2,
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0.2,
      },
      {
        label: "Your plan",
        data: fit(plan.balanceSeries),
        borderColor: pal.blue,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 18, right: 10 } },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      debtFreeMarker: {
        index: payoffIndex,
        text: debtFreeMonth ? fmtMonthLabel(debtFreeMonth) : "",
        line: chrome.tick,
        fill: chrome.tooltipBg,
        stroke: chrome.grid,
        ink: chrome.tooltipTitle,
      },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        borderColor: chrome.grid,
        borderWidth: 1,
        padding: 10,
        usePointStyle: true,
        callbacks: {
          title: (items) => fmtMonthLabel(String(items[0]?.label ?? "")),
          label: (c) => `${c.dataset.label}: ${fmtUsd(Number(c.parsed.y))}`,
          labelPointStyle: () => ({ pointStyle: "line" as const, rotation: 0 }),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: chrome.grid },
        ticks: {
          color: chrome.tick,
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: false,
          // The label is "YYYY-MM", so slice the year off it.
          callback: (_v, i) =>
            i % (12 * tickStep) === 0 ? labels[i].slice(0, 4) : "",
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: chrome.grid },
        border: { display: false },
        ticks: {
          color: chrome.tick,
          font: { size: 10 },
          maxTicksLimit: 6,
          callback: (v) => fmtUsdCompact(Number(v)),
        },
      },
    },
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[15px] font-medium text-ink">What you still owe</h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <LegendKey color={pal.blue} label="Your plan" />
          <LegendKey color={pal.grey} label="Minimums, paid separately" dashed />
        </div>
      </div>
      <div className="h-[260px] w-full">
        <Line
          data={data}
          options={options}
          plugins={[debtFreeMarker]}
          aria-label={summary}
        />
      </div>
    </div>
  );
}
