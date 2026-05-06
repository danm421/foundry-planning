// src/components/reports/widgets/monte-carlo-fan.tsx
//
// Screen render for the monteCarloFan widget. Chart.js Line with Filler
// for stacked confidence bands (p5/p25/p50/p75/p95), scoped from
// `monteCarlo`. The PDF render is a native @react-pdf/renderer SVG fan
// that consumes the same scope data — no canvas snapshot.
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
    }[] = [];
    if (enabled.has(95)) {
      datasets.push({
        label: "95th",
        data: bands.map((b) => b.p95),
        borderColor: "#3461a8",
        backgroundColor: "#3461a833",
        fill: "+1",
        pointRadius: 0,
      });
    }
    if (enabled.has(75)) {
      datasets.push({
        label: "75th",
        data: bands.map((b) => b.p75),
        borderColor: "#3461a8",
        backgroundColor: "#3461a866",
        fill: "+1",
        pointRadius: 0,
      });
    }
    if (enabled.has(50)) {
      datasets.push({
        label: "50th",
        data: bands.map((b) => b.p50),
        borderColor: "#1a1a1d",
        backgroundColor: "transparent",
        pointRadius: 0,
      });
    }
    if (enabled.has(25)) {
      datasets.push({
        label: "25th",
        data: bands.map((b) => b.p25),
        borderColor: "#3461a8",
        backgroundColor: "#3461a866",
        fill: "-1",
        pointRadius: 0,
      });
    }
    if (enabled.has(5)) {
      datasets.push({
        label: "5th",
        data: bands.map((b) => b.p5),
        borderColor: "#3461a8",
        backgroundColor: "#3461a833",
        fill: "-1",
        pointRadius: 0,
      });
    }
    return { labels, datasets };
  }, [bands, p.props.bands]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: {}, y: {} },
    }),
    [],
  );

  const headline =
    d?.successProbability == null
      ? "—"
      : `${(d.successProbability * 100).toFixed(0)}% chance of success`;

  return (
    <div className="p-4 bg-card-2 rounded-md border border-hair">
      <div className="text-[14px] text-ink mb-2">{p.props.title}</div>
      {p.props.subtitle && (
        <div className="text-[12px] text-ink-3 mb-2">{p.props.subtitle}</div>
      )}
      {p.props.showHeadline && (
        <div className="text-[24px] font-serif text-ink mb-3">{headline}</div>
      )}
      <div style={{ height: 260 }}>
        {bands.length > 0 ? (
          <Line data={data} options={options} />
        ) : (
          <div className="flex items-center justify-center h-full text-[12px] text-ink-3">
            Monte Carlo trials not yet available.
          </div>
        )}
      </div>
    </div>
  );
}
