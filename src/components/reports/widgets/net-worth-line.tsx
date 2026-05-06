// src/components/reports/widgets/net-worth-line.tsx
//
// Screen render for the netWorthLine widget. Chart.js Line of net worth over
// time, scoped from `balance`. The PDF render is a native @react-pdf/renderer
// SVG chart that consumes the same scope data — no canvas snapshot.
//
// Visual parity with the PDF render: single accent line on top of a low-
// opacity area fill, mono axis ticks, hairline grid, and an end-point
// value label (last year's net worth) anchored above the final point.
//
// `compareScenarioId` is wired into the inspector but resolves to `null` in
// v1 — the secondary trajectory will land with the scenario-comparison
// feature. Single-line render only, for now.
//
// PDF render lives at `components/reports-pdf/widgets/net-worth-line.tsx`
// and is attached to the registry entry by
// `lib/reports/widgets/net-worth-line.pdf.ts`, which only loads in the
// server bundle — keeping `@react-pdf/renderer` out of the client bundle
// and (symmetrically) keeping `chart.js` / `react-chartjs-2` out of the
// PDF bundle.

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  Filler,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type Plugin,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { BalanceScopeData } from "@/lib/reports/scopes/balance";
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
const ACCENT = C.accent;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

// Endpoint label plugin — draws the final-year net-worth value above the
// last point on the line. Mirrors the PDF widget's endpoint affordance.
const endpointLabelPlugin: Plugin<"line"> = {
  id: "endpointLabel",
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;
    if (!data.datasets || data.datasets.length === 0) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data || meta.data.length === 0) return;
    const lastIdx = meta.data.length - 1;
    const lastPoint = meta.data[lastIdx] as unknown as { x: number; y: number };
    const value = (data.datasets[0].data as number[])[lastIdx];
    if (!Number.isFinite(value)) return;
    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.font = `9px ${MONO_FONT}`;
    ctx.textAlign = "end";
    ctx.textBaseline = "bottom";
    ctx.fillText(fmtCompactDollar(value), lastPoint.x, lastPoint.y - 6);
    ctx.restore();
  },
};

export function NetWorthLineRender(p: WidgetRenderProps<"netWorthLine">) {
  const ctx = useReportContext();
  const range = resolveYearRange(p.props.yearRange, ctx.household);
  const d = (p.data as { balance?: BalanceScopeData })?.balance;
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
          label: "Net worth",
          data: years.map((y) => y.netWorth),
          borderColor: ACCENT,
          backgroundColor: hexWithAlpha(ACCENT, 0.18),
          pointRadius: p.props.showMarkers ? 3 : 0,
          pointBackgroundColor: ACCENT,
          pointBorderColor: ACCENT,
          borderWidth: 1.6,
          tension: 0.15,
          fill: true,
        },
      ],
    }),
    [years, p.props.showMarkers],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          titleFont: { family: MONO_FONT, size: 10 },
          bodyFont: { family: MONO_FONT, size: 10 },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: C.hair },
          ticks: {
            color: C.ink3,
            font: { family: MONO_FONT, size: 9 },
          },
        },
        y: {
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
    [p.props.showGrid],
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
        <Line data={data} options={options} plugins={[endpointLabelPlugin]} />
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
