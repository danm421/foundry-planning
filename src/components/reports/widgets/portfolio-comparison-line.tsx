// src/components/reports/widgets/portfolio-comparison-line.tsx
//
// Screen render for the portfolioComparisonLine widget. Two Chart.js lines —
// "Current" (slate gray, dashed) and "Proposed" (accent gold, solid) —
// over the same year range, sourced from each side's
// `balance.years[].netWorth`. The widget reads from `data.comparison` —
// the data-loader stamps `widgetData[w.id]` with the resolved
// `ComparisonScopeData` for comparison-aware widget kinds (see
// `load-widget-data.ts`).
//
// When the report has no `comparisonBinding`, the empty-state card prompts
// the advisor to bind two scenarios. PDF render lives at
// `components/reports-pdf/widgets/portfolio-comparison-line.tsx`.

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { ComparisonScopeData } from "@/lib/reports/scopes/comparison";
import { resolveYearRange } from "@/lib/reports/year-range-default";
import { REPORT_THEME } from "@/lib/reports/theme";
import { fmtCompactDollar } from "./chart-shared";
import { useReportContext } from "../builder-context";

ChartJS.register(
  Filler,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

const C = REPORT_THEME.colors;
const CURRENT_COLOR = C.ink2; // slate gray
const PROPOSED_COLOR = C.accent; // gold
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

type CompPayload = { comparison?: ComparisonScopeData } | null | undefined;

/** Project a single side into `{ year, netWorth }` rows the chart consumes. */
function sideSeries(side: ComparisonScopeData["current"]) {
  return side.balance.years.map((y) => ({
    year: y.year,
    netWorth: y.netWorth,
  }));
}

export function PortfolioComparisonLineRender(
  p: WidgetRenderProps<"portfolioComparisonLine">,
) {
  const comparison = (p.data as CompPayload)?.comparison;
  if (!comparison) {
    return <EmptyState title={p.props.title} />;
  }
  // Render the chart in a child component so memoization doesn't have to
  // straddle a nullable input. Cleaner for the React Compiler too.
  return (
    <ChartCard
      title={p.props.title}
      subtitle={p.props.subtitle}
      showGrid={p.props.showGrid}
      yearRange={p.props.yearRange}
      comparison={comparison}
    />
  );
}

function ChartCard({
  title,
  subtitle,
  showGrid,
  yearRange,
  comparison,
}: {
  title: string;
  subtitle?: string;
  showGrid: boolean;
  yearRange: { from: number | "default"; to: number | "default" };
  comparison: ComparisonScopeData;
}) {
  const ctx = useReportContext();
  const range = resolveYearRange(yearRange, ctx.household);

  // Plain locals — React 19 + the React Compiler memoizes these for us.
  // Manual `useMemo` here trips `react-hooks/preserve-manual-memoization`
  // because of the multi-return shape; idiomatic React 19 is to compute
  // and let the compiler handle caching.
  const cur = sideSeries(comparison.current).filter(
    (y) => y.year >= range.from && y.year <= range.to,
  );
  const prop = sideSeries(comparison.proposed).filter(
    (y) => y.year >= range.from && y.year <= range.to,
  );
  const longer = cur.length >= prop.length ? cur : prop;
  const labels = longer.map((y) => String(y.year));
  const curValues = cur.map((y) => y.netWorth);
  const propValues = prop.map((y) => y.netWorth);

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Current",
          data: curValues,
          borderColor: CURRENT_COLOR,
          backgroundColor: CURRENT_COLOR,
          borderDash: [4, 3],
          pointRadius: 0,
          borderWidth: 1.4,
          tension: 0.15,
          fill: false,
        },
        {
          label: "Proposed",
          data: propValues,
          borderColor: PROPOSED_COLOR,
          backgroundColor: PROPOSED_COLOR,
          pointRadius: 0,
          borderWidth: 1.8,
          tension: 0.15,
          fill: false,
        },
      ],
    }),
    [labels, curValues, propValues],
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
          grid: { display: false },
          border: { color: C.hair },
          ticks: { color: C.ink3, font: { family: MONO_FONT, size: 9 } },
        },
        y: {
          grid: {
            display: showGrid,
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
    [showGrid],
  );

  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      <div className="text-base font-serif font-medium text-report-ink mb-1">
        {title}
      </div>
      {subtitle && (
        <div className="text-xs text-report-ink-3 mb-3">{subtitle}</div>
      )}
      <div style={{ height: 280 }}>
        <Line data={data} options={options} />
      </div>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="bg-report-card border border-report-hair rounded-md p-6 text-center text-report-ink-3">
      <div className="text-base font-serif font-medium text-report-ink mb-2">
        {title}
      </div>
      <div className="text-xs">Bind two scenarios to use this widget.</div>
    </div>
  );
}
