// src/components/reports/widgets/monte-carlo-fan.tsx
//
// Screen render for the monteCarloFan widget. Chart.js Line with Filler
// for stacked confidence bands (p5/p25/p50/p75/p95), scoped from
// `monteCarlo`. The PDF render is a native @react-pdf/renderer SVG fan
// that consumes the same scope data — no canvas snapshot.
//
// Visual parity with the PDF render: bands render in `accent` (orange)
// at varying alpha (outer p5/p95 lighter, inner p25/p75 darker, median
// p50 a 1.4px solid accent line). The success-probability headline
// renders in serif (Fraunces) above the chart so it reads as the page's
// main number.
//
// v1 reality: the `monteCarlo` scope is a documented stub returning
// `{ successProbability: null, bands: [] }` — the widget renders a "—"
// headline and a "not yet available" placeholder until the engine wiring
// lands. The render path here is fully ready for real data; nothing needs
// to change in this file when the scope flips off its stub.
//
// Fill chains: `fill: "+1"` / `"-1"` tell Chart.js to fill toward the
// next/previous dataset, which makes the bands stack visually around the
// median without needing per-band absolute fill targets.
//
// PDF render lives at `components/reports-pdf/widgets/monte-carlo-fan.tsx`
// and is attached by `lib/reports/widgets/monte-carlo-fan.pdf.ts` on the
// server-only barrel — keeping `@react-pdf/renderer` out of the client
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
import type { MonteCarloScopeData } from "@/lib/reports/scopes/monteCarlo";
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

const C = REPORT_THEME.colors;
const ACCENT = C.accent;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

// Alpha rules mirror the PDF render: outer band (5/95) at ~18%, inner band
// (25/75) at ~32%, median as the solid darker accent line.
const BAND_ALPHAS = {
  outer: 0.18,
  inner: 0.32,
} as const;

export function MonteCarloFanRender(p: WidgetRenderProps<"monteCarloFan">) {
  const ctx = useReportContext();
  const range = resolveYearRange(p.props.yearRange, ctx.household);
  const d = (p.data as { monteCarlo?: MonteCarloScopeData })?.monteCarlo;
  const bands = (d?.bands ?? []).filter(
    (b) => b.year >= range.from && b.year <= range.to,
  );

  // Memoize the Chart.js inputs — Chart.js does identity comparison and
  // re-animates on every parent re-render. Inspector keystrokes (band
  // toggles especially) shouldn't thrash the chart.
  const data = useMemo(() => {
    const labels = bands.map((b) => String(b.year));
    const enabled = new Set<number>(p.props.bands);
    const outerFill = hexWithAlpha(ACCENT, BAND_ALPHAS.outer);
    const innerFill = hexWithAlpha(ACCENT, BAND_ALPHAS.inner);
    // Order matters for the fill chains: outer (95) → middle (75) → median
    // (50) → middle (25) → outer (5). "+1" fills toward the next dataset,
    // "-1" toward the previous; this stacks the bands around the median.
    const datasets: {
      label: string;
      data: number[];
      borderColor: string;
      backgroundColor: string;
      fill?: boolean | string;
      pointRadius: number;
      borderWidth: number;
    }[] = [];
    if (enabled.has(95)) {
      datasets.push({
        label: "95th",
        data: bands.map((b) => b.p95),
        borderColor: "transparent",
        backgroundColor: outerFill,
        fill: "+1",
        pointRadius: 0,
        borderWidth: 0,
      });
    }
    if (enabled.has(75)) {
      datasets.push({
        label: "75th",
        data: bands.map((b) => b.p75),
        borderColor: "transparent",
        backgroundColor: innerFill,
        fill: "+1",
        pointRadius: 0,
        borderWidth: 0,
      });
    }
    if (enabled.has(50)) {
      datasets.push({
        label: "50th",
        data: bands.map((b) => b.p50),
        borderColor: ACCENT,
        backgroundColor: "transparent",
        pointRadius: 0,
        borderWidth: 1.4,
      });
    }
    if (enabled.has(25)) {
      datasets.push({
        label: "25th",
        data: bands.map((b) => b.p25),
        borderColor: "transparent",
        backgroundColor: innerFill,
        fill: "-1",
        pointRadius: 0,
        borderWidth: 0,
      });
    }
    if (enabled.has(5)) {
      datasets.push({
        label: "5th",
        data: bands.map((b) => b.p5),
        borderColor: "transparent",
        backgroundColor: outerFill,
        fill: "-1",
        pointRadius: 0,
        borderWidth: 0,
      });
    }
    return { labels, datasets };
  }, [bands, p.props.bands]);

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

  const headline =
    d?.successProbability == null
      ? "—"
      : `${(d.successProbability * 100).toFixed(0)}% chance of success`;

  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      <div className="text-base font-serif font-medium text-report-ink mb-1">
        {p.props.title}
      </div>
      {p.props.subtitle && (
        <div className="text-xs text-report-ink-3 mb-3">{p.props.subtitle}</div>
      )}
      {p.props.showHeadline && (
        <div
          className="text-3xl font-serif text-report-ink mb-3 text-center"
          style={{ fontFamily: 'Fraunces, "Times New Roman", serif' }}
        >
          {headline}
        </div>
      )}
      <div style={{ height: 260 }}>
        {bands.length > 0 ? (
          <Line data={data} options={options} />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-report-ink-3">
            Monte Carlo trials not yet available.
          </div>
        )}
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
