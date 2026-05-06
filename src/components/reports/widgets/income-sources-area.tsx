// src/components/reports/widgets/income-sources-area.tsx
//
// Screen render for the incomeSourcesArea widget. Stacked Chart.js Line
// (with Filler) of annual income mix, scoped from `cashflow`. Datasets
// are filtered in/out by `props.series`. The PDF render is a native
// @react-pdf/renderer SVG stacked-area chart that consumes the same
// scope data — no canvas snapshot.
//
// Visual parity with the PDF render: same series ordering and same
// palette (`REPORT_THEME.chartPalette`), hairline grid, mono axis ticks,
// bottom-aligned legend with colored swatches.
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
import { REPORT_THEME } from "@/lib/reports/theme";
import { fmtCompactDollar } from "./chart-shared";
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

const PALETTE = REPORT_THEME.chartPalette;
const C = REPORT_THEME.colors;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

// Series ordering + colors mirror the PDF render so screen and PDF stack
// the same way. Indices into `chartPalette`: wages=0 (accent), socialSec=1
// (good), pensions=2 (steel), withdrawals=3 (plum), other=5 (ink2).
const SERIES_DEFS: readonly {
  key: IncomeSourcesSeries;
  label: string;
  color: string;
  read: (y: CashflowScopeData["years"][number]) => number;
}[] = [
  { key: "wages",          label: "Wages",           color: PALETTE[0], read: (y) => y.incomeWages },
  { key: "socialSecurity", label: "Social Security", color: PALETTE[1], read: (y) => y.incomeSocialSecurity },
  { key: "pensions",       label: "Pensions",        color: PALETTE[2], read: (y) => y.incomePensions },
  { key: "withdrawals",    label: "Withdrawals",     color: PALETTE[3], read: (y) => y.incomeWithdrawals },
  { key: "other",          label: "Other",           color: PALETTE[5], read: (y) => y.incomeOther },
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
          backgroundColor: hexWithAlpha(s.color, 0.55),
          fill: true,
          stack: "income",
          pointRadius: 0,
          tension: 0.15,
          borderWidth: 1,
        }),
      ),
    }),
    [years, p.props.series],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
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
          stacked: true,
          grid: { display: false },
          border: { color: C.hair },
          ticks: {
            color: C.ink3,
            font: { family: MONO_FONT, size: 9 },
          },
        },
        y: {
          stacked: true,
          grid: {
            display: true,
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
    [],
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
        <Line data={data} options={options} />
      </div>
    </div>
  );
}

// Tiny helper so we don't pull tinycolor for one alpha conversion. Assumes
// `#rrggbb`; the chart palette in REPORT_THEME satisfies that.
function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${aHex}`;
}
