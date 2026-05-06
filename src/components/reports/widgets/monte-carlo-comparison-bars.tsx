// src/components/reports/widgets/monte-carlo-comparison-bars.tsx
//
// Screen render for the monteCarloComparisonBars widget. Two bars
// side-by-side showing each side's `monteCarlo.successProbability` as a
// percent. Current = slate gray (`ink2`); Proposed = sage green (`good`).
// Big mono value labels above each bar so the reader gets the percent
// without scanning the y-axis. Uses Chart.js Bar so the on-screen render
// matches every other Chart.js widget's interaction model (tooltip + axis
// styling). PDF render is a native SVG sibling.

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type Plugin,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { ComparisonScopeData } from "@/lib/reports/scopes/comparison";
import { REPORT_THEME } from "@/lib/reports/theme";
import { ComparisonEmptyState } from "./comparison-empty-state";

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const C = REPORT_THEME.colors;
const CURRENT_COLOR = C.ink2;
const PROPOSED_COLOR = C.good;
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

type CompPayload = { comparison?: ComparisonScopeData } | null | undefined;

/** Convert the scope's 0–1 probability into a 0–100 percent for display.
 *  Already-percentage values (>= 1.5) pass through unchanged so the widget
 *  is forgiving if the engine flips its convention. */
function asPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p <= 1.5) return p * 100;
  return p;
}

// Plugin draws the percentage above each bar in mono so it reads the same
// as every other value-label affordance in the report system.
const valueLabelPlugin: Plugin<"bar"> = {
  id: "comparisonBarValueLabel",
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data) return;
    const ctx = chart.ctx;
    const values = chart.data.datasets[0]?.data as number[] | undefined;
    if (!values) return;
    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.font = `600 14px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    meta.data.forEach((bar, i) => {
      const v = values[i];
      if (!Number.isFinite(v)) return;
      const tip = bar.tooltipPosition(true);
      const x: number = tip.x ?? 0;
      const yTop: number = (bar as unknown as { y?: number }).y ?? tip.y ?? 0;
      ctx.fillText(`${Math.round(v)}%`, x, yTop - 6);
    });
    ctx.restore();
  },
};

export function MonteCarloComparisonBarsRender(
  p: WidgetRenderProps<"monteCarloComparisonBars">,
) {
  const comparison = (p.data as CompPayload)?.comparison;

  const values = useMemo(() => {
    if (!comparison) return null;
    const d = comparison.delta.successProbability;
    return [asPercent(d.current), asPercent(d.proposed)];
  }, [comparison]);

  const data = useMemo(
    () => ({
      labels: ["Current", "Proposed"],
      datasets: [
        {
          label: "Probability of success",
          data: values ?? [0, 0],
          backgroundColor: [CURRENT_COLOR, PROPOSED_COLOR],
          borderWidth: 0,
          borderRadius: 0,
          maxBarThickness: 90,
        },
      ],
    }),
    [values],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      // A bit of headroom at the top so the value label doesn't get clipped
      // when the bar reaches 100%.
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          titleFont: { family: MONO_FONT, size: 10 },
          bodyFont: { family: MONO_FONT, size: 10 },
          callbacks: {
            label: (item: { parsed: { y: number | null } }) => {
              const y = item.parsed.y ?? 0;
              return `${Math.round(y)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: C.hair },
          ticks: { color: C.ink2, font: { family: MONO_FONT, size: 10 } },
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: C.hair, drawTicks: false },
          border: { display: false },
          ticks: {
            color: C.ink3,
            font: { family: MONO_FONT, size: 9 },
            callback: (v: string | number) => `${v}%`,
            stepSize: 25,
          },
        },
      },
    }),
    [],
  );

  if (!comparison) {
    return <ComparisonEmptyState title={p.props.title} />;
  }

  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      <div className="text-base font-serif font-medium text-report-ink mb-1">
        {p.props.title}
      </div>
      {p.props.subtitle && (
        <div className="text-xs text-report-ink-3 mb-3">{p.props.subtitle}</div>
      )}
      <div style={{ height: 280 }}>
        <Bar data={data} options={options} plugins={[valueLabelPlugin]} />
      </div>
    </div>
  );
}

