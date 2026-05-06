// src/components/reports/widgets/income-sources-area.tsx
//
// Screen render for the incomeSourcesArea widget. Stacked Chart.js Line
// (with Filler) of annual income mix, scoped from `cashflow`. Datasets
// are filtered in/out by `props.series`. The PDF render is a native
// @react-pdf/renderer SVG stacked-area chart that consumes the same
// scope data — no canvas snapshot.
//
// PDF render lives at `components/reports-pdf/widgets/income-sources-area.tsx`
// and is attached to the registry entry by
// `lib/reports/widgets/income-sources-area.pdf.ts`, which only loads in
// the server bundle — keeping `@react-pdf/renderer` out of the client
// bundle and (symmetrically) keeping `chart.js` / `react-chartjs-2` out
// of the PDF bundle.

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  Filler,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";
import type { IncomeSourcesSeries } from "@/lib/reports/types";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { useReportContext } from "../builder-context";

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  Filler,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

// Single source of truth for the dataset shape — keeps the render DRY
// and makes the inspector's series options trivially derivable. Colors
// are inline pending the chart-palette extraction logged in
// future-work/ui.md ("Chart palette constant").
const SERIES_DEFS: readonly {
  key: IncomeSourcesSeries;
  label: string;
  color: string;
  read: (y: CashflowScopeData["years"][number]) => number;
}[] = [
  { key: "wages",          label: "Wages",           color: "#b87f1f", read: (y) => y.incomeWages },
  { key: "socialSecurity", label: "Social Security", color: "#2f6b4a", read: (y) => y.incomeSocialSecurity },
  { key: "pensions",       label: "Pensions",        color: "#3461a8", read: (y) => y.incomePensions },
  { key: "withdrawals",    label: "Withdrawals",     color: "#7a4ea3", read: (y) => y.incomeWithdrawals },
  { key: "other",          label: "Other",           color: "#5a5a60", read: (y) => y.incomeOther },
];

export function IncomeSourcesAreaRender(
  p: WidgetRenderProps<"incomeSourcesArea">,
) {
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
      datasets: SERIES_DEFS.filter((s) => p.props.series.includes(s.key)).map(
        (s) => ({
          label: s.label,
          data: years.map(s.read),
          borderColor: s.color,
          backgroundColor: s.color + "55", // ~33% alpha for area fill
          fill: true,
          stack: "income",
          pointRadius: 0,
          tension: 0.15,
        }),
      ),
    }),
    [years, p.props.series],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, grid: { display: true } },
      },
    }),
    [],
  );

  return (
    <div className="p-4 bg-card-2 rounded-md border border-hair">
      <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
      {p.props.subtitle && (
        <div className="text-[12px] text-ink-3 mb-2">{p.props.subtitle}</div>
      )}
      <div style={{ height: 280 }}>
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
