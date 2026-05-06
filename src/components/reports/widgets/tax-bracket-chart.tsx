// src/components/reports/widgets/tax-bracket-chart.tsx
//
// Screen render for the taxBracketChart widget. Stacked Chart.js bar of
// per-year income split across federal tax brackets. Each bar has up to
// seven segments (10% → 37%); each segment is colored by bracket via the
// shared bracket palette.
//
// V1 limitations (mirrored in PDF render):
// - Single-filer brackets only, hard-coded inline (see `tax-bracket-chart.shared.ts`).
// - `showRothBands` toggle is wired but no-op — Roth conversion overlay
//   needs Roth-conversion data plumbed through cashflow scope.
//
// Visual pattern matches the cashflowBarChart screen render: cream/light
// bordered card, subsection-styled title, mono axis ticks, hairline grid.

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
import {
  totalIncome,
  type CashflowScopeData,
} from "@/lib/reports/scopes/cashflow";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { REPORT_THEME } from "@/lib/reports/theme";
import { fmtCompactDollar } from "./chart-shared";
import { useReportContext } from "../builder-context";
import {
  BRACKETS_2026_SINGLE,
  BRACKET_COLORS,
  splitIncomeIntoBrackets,
} from "@/lib/reports/widgets/tax-bracket-chart.shared";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

const C = REPORT_THEME.colors;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

export function TaxBracketChartRender(p: WidgetRenderProps<"taxBracketChart">) {
  const ctx = useReportContext();
  const range = resolveYearRange(p.props.yearRange, ctx.household);
  const d = (p.data as { cashflow?: CashflowScopeData })?.cashflow;
  const years = useMemo(
    () =>
      (d?.years ?? []).filter(
        (y) => y.year >= range.from && y.year <= range.to,
      ),
    [d?.years, range.from, range.to],
  );

  const data = useMemo(() => {
    const labels = years.map((y) => String(y.year));
    // One dataset per bracket, stacked. Tooltip-friendly labels include
    // the bracket rate so hovering surfaces "10% bracket: $11,600".
    const datasets = BRACKETS_2026_SINGLE.map(([, , rate], idx) => ({
      label: `${rate}% bracket`,
      backgroundColor: BRACKET_COLORS[idx],
      borderWidth: 0,
      borderRadius: 0,
      stack: "tax",
      data: years.map((y) => {
        const slices = splitIncomeIntoBrackets(totalIncome(y));
        return slices[idx].amount;
      }),
    }));
    return { labels, datasets };
  }, [years]);

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
            padding: 10,
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
          ticks: { color: C.ink3, font: { family: MONO_FONT, size: 9 } },
        },
        y: {
          stacked: true,
          grid: { display: true, color: C.hair, drawTicks: false },
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
      {years.length === 0 ? (
        <div className="text-xs text-report-ink-3 italic py-12 text-center">
          No income data — preview shown only at export.
        </div>
      ) : (
        <div style={{ height: 280 }}>
          <Bar data={data} options={options} />
        </div>
      )}
    </div>
  );
}
