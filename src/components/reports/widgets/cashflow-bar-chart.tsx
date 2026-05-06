// src/components/reports/widgets/cashflow-bar-chart.tsx
//
// Screen render for the cashflowBarChart widget. Stacked Chart.js bar of
// annual income vs spending, scoped from `cashflow`. The PDF render is a
// native @react-pdf/renderer SVG chart that consumes the same scope data
// — no canvas snapshot.
//
// Visual parity with the PDF render is the goal: same series ordering,
// same colors (sourced from `REPORT_THEME.chartPalette`), hairline grid,
// mono axis ticks, value labels above income totals. The card chrome
// uses the `report-*` Tailwind namespace so the cream/light palette
// reads correctly on the dark app shell.
//
// PDF render lives at `components/reports-pdf/widgets/cashflow-bar-chart.tsx`
// and is attached to the registry entry by
// `lib/reports/widgets/cashflow-bar-chart.pdf.ts`, which only loads in the
// server bundle — keeping `@react-pdf/renderer` out of the client bundle
// and (symmetrically) keeping `chart.js` / `react-chartjs-2` out of the PDF
// bundle.

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type Plugin,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { REPORT_THEME } from "@/lib/reports/theme";
import { fmtCompactDollar } from "./chart-shared";
import { useReportContext } from "../builder-context";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

const PALETTE = REPORT_THEME.chartPalette;
const C = REPORT_THEME.colors;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

// Custom Chart.js plugin that draws compact-dollar value labels above the
// per-x income total. Mirrors the PDF widget's optional value-label affordance.
// Uses dataset metadata so we don't have to re-walk the chart.config every
// frame.
const incomeTotalLabelPlugin: Plugin<"bar"> = {
  id: "incomeTotalLabel",
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;
    if (!data.datasets || data.datasets.length === 0) return;
    // Income datasets all share `stack: "income"`. Find the topmost one
    // (last in the array) so we can anchor labels to its bar tops.
    let topIndex = -1;
    for (let i = data.datasets.length - 1; i >= 0; i--) {
      const ds = data.datasets[i] as { stack?: string };
      if (ds.stack === "income") {
        topIndex = i;
        break;
      }
    }
    if (topIndex < 0) return;
    const meta = chart.getDatasetMeta(topIndex);
    if (!meta?.data) return;

    const xCount = (data.labels?.length ?? 0) as number;
    const totals: number[] = new Array(xCount).fill(0);
    data.datasets.forEach((ds) => {
      if ((ds as { stack?: string }).stack !== "income") return;
      const arr = ds.data as (number | null)[];
      for (let i = 0; i < xCount; i++) totals[i] += arr[i] ?? 0;
    });

    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.font = `9px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    meta.data.forEach((bar, i) => {
      const t: number = totals[i] ?? 0;
      if (!Number.isFinite(t) || t === 0) return;
      // Chart.js Point fields are typed `number | null`; in practice they're
      // always concrete numbers when the bar exists. Coerce defensively.
      const tip = bar.tooltipPosition(true);
      const x: number = tip.x ?? 0;
      const fallbackY: number = tip.y ?? 0;
      // bar.y here is the top edge of the topmost stacked income bar; nudge
      // up a few pixels so the label doesn't crowd the bar.
      const yTop: number = (bar as unknown as { y?: number }).y ?? fallbackY;
      ctx.fillText(fmtCompactDollar(t), x, yTop - 4);
    });
    ctx.restore();
  },
};

export function CashflowBarChartRender(p: WidgetRenderProps<"cashflowBarChart">) {
  const ctx = useReportContext();
  const range = resolveYearRange(p.props.yearRange, ctx.household);
  const d = (p.data as { cashflow?: CashflowScopeData })?.cashflow;
  const years = (d?.years ?? []).filter(
    (y) => y.year >= range.from && y.year <= range.to,
  );

  // Memoize the Chart.js inputs — Chart.js does identity comparison and
  // re-animates on every parent re-render. Inspector keystrokes shouldn't
  // thrash the chart.
  const data = useMemo(
    () => ({
      labels: years.map((y) => String(y.year)),
      datasets: [
        {
          label: "Wages",
          data: years.map((y) => y.incomeWages),
          backgroundColor: PALETTE[0],
          borderWidth: 0,
          borderRadius: 0,
          stack: "income",
        },
        {
          label: "Social Security",
          data: years.map((y) => y.incomeSocialSecurity),
          backgroundColor: PALETTE[1],
          borderWidth: 0,
          borderRadius: 0,
          stack: "income",
        },
        {
          label: "Pensions",
          data: years.map((y) => y.incomePensions),
          backgroundColor: PALETTE[2],
          borderWidth: 0,
          borderRadius: 0,
          stack: "income",
        },
        {
          label: "Withdrawals",
          data: years.map((y) => y.incomeWithdrawals),
          backgroundColor: PALETTE[3],
          borderWidth: 0,
          borderRadius: 0,
          stack: "income",
        },
        {
          label: "Other",
          data: years.map((y) => y.incomeOther),
          backgroundColor: PALETTE[5],
          borderWidth: 0,
          borderRadius: 0,
          stack: "income",
        },
        {
          label: "Expenses",
          data: years.map((y) => -y.expenses),
          backgroundColor: C.crit,
          borderWidth: 0,
          borderRadius: 0,
          stack: "expense",
        },
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
          display: p.props.showLegend,
          position: "bottom" as const,
          labels: {
            color: C.ink2,
            font: { family: MONO_FONT, size: 9 },
            boxWidth: 8,
            boxHeight: 8,
            padding: 12,
          },
        },
        tooltip: {
          titleFont: { family: MONO_FONT, size: 10 },
          bodyFont: { family: MONO_FONT, size: 10 },
        },
      },
      scales: {
        x: {
          stacked: p.props.stacking === "stacked",
          grid: { display: false },
          border: { color: C.hair },
          ticks: {
            color: C.ink3,
            font: { family: MONO_FONT, size: 9 },
          },
        },
        y: {
          stacked: p.props.stacking === "stacked",
          grid: {
            display: p.props.showGrid,
            color: C.hair,
            drawTicks: false,
          },
          border: { display: false },
          ticks: {
            color: C.ink3,
            font: { family: MONO_FONT, size: 9 },
            callback: (v: string | number) =>
              fmtCompactDollar(typeof v === "string" ? Number(v) : v),
          },
        },
      },
    }),
    [p.props.showLegend, p.props.showGrid, p.props.stacking],
  );

  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      <div className="text-base font-serif font-medium text-report-ink mb-1">
        {p.props.title}
      </div>
      {p.props.subtitle && (
        <div className="text-xs text-report-ink-3 mb-3">{p.props.subtitle}</div>
      )}
      <div style={{ height: 280 }}>
        <Bar data={data} options={options} plugins={[incomeTotalLabelPlugin]} />
      </div>
    </div>
  );
}
