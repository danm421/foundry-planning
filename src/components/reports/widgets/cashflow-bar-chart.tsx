// src/components/reports/widgets/cashflow-bar-chart.tsx
//
// Screen render for the cashflowBarChart widget. Stacked Chart.js bar of
// annual income vs spending, scoped from `cashflow`. The wrapper div is
// tagged with `data-widget-canvas` so the builder's export handler can
// snapshot the inner canvas to a PNG for the PDF embed.
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
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { useReportContext } from "../builder-context";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

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
          backgroundColor: "#b87f1f",
          stack: "income",
        },
        {
          label: "Social Security",
          data: years.map((y) => y.incomeSocialSecurity),
          backgroundColor: "#2f6b4a",
          stack: "income",
        },
        {
          label: "Pensions",
          data: years.map((y) => y.incomePensions),
          backgroundColor: "#3461a8",
          stack: "income",
        },
        {
          label: "Withdrawals",
          data: years.map((y) => y.incomeWithdrawals),
          backgroundColor: "#7a4ea3",
          stack: "income",
        },
        {
          label: "Other",
          data: years.map((y) => y.incomeOther),
          backgroundColor: "#5a5a60",
          stack: "income",
        },
        {
          label: "Expenses",
          data: years.map((y) => -y.expenses),
          backgroundColor: "#a13a3a",
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
      plugins: { legend: { display: p.props.showLegend } },
      scales: {
        x: { stacked: p.props.stacking === "stacked" },
        y: {
          stacked: p.props.stacking === "stacked",
          grid: { display: p.props.showGrid },
        },
      },
    }),
    [p.props.showLegend, p.props.showGrid, p.props.stacking],
  );

  return (
    <div className="p-4 bg-card-2 rounded-md border border-hair">
      <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
      {p.props.subtitle && (
        <div className="text-[12px] text-ink-3 mb-2">{p.props.subtitle}</div>
      )}
      <div
        data-widget-canvas
        data-widget-id={p.widgetId}
        style={{ height: 280 }}
      >
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}
