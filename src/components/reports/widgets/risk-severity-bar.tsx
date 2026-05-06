// src/components/reports/widgets/risk-severity-bar.tsx
//
// Screen render for the riskSeverityBar widget. Horizontal Chart.js bar
// chart — one bar per risk row. Bar length = severity tier
// (low=1, medium=2, high=3); bar color = severity color from the design
// system (low → good, medium → accent, high → crit).
//
// X-axis labeled "Low / Medium / High" at tick positions 1/2/3.
//
// PDF render lives at `components/reports-pdf/widgets/risk-severity-bar.tsx`.

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
  type TooltipItem,
} from "chart.js";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { RiskSeverity } from "@/lib/reports/types";
import { REPORT_THEME } from "@/lib/reports/theme";

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

const SEVERITY_TIER: Record<RiskSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  low: C.good,
  medium: C.accent,
  high: C.crit,
};

const SEVERITY_TICK_LABEL: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};

export function RiskSeverityBarRender(
  p: WidgetRenderProps<"riskSeverityBar">,
) {
  const rows = p.props.rows;

  const data = useMemo(
    () => ({
      labels: rows.map((r) => r.area),
      datasets: [
        {
          label: "Severity",
          data: rows.map((r) => SEVERITY_TIER[r.severity]),
          backgroundColor: rows.map((r) => SEVERITY_COLOR[r.severity]),
          borderWidth: 0,
          borderRadius: 2,
        },
      ],
    }),
    [rows],
  );

  const options = useMemo(
    () => ({
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          titleFont: { family: MONO_FONT, size: 10 },
          bodyFont: { family: MONO_FONT, size: 10 },
          callbacks: {
            label: (item: TooltipItem<"bar">) => {
              const x = item.parsed.x;
              if (x == null) return "";
              return SEVERITY_TICK_LABEL[x] ?? String(x);
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          min: 0,
          max: 3,
          grid: { display: false },
          border: { color: C.hair },
          ticks: {
            color: C.ink3,
            font: { family: MONO_FONT, size: 9 },
            stepSize: 1,
            callback: (v: string | number) => {
              const n = typeof v === "string" ? Number(v) : v;
              return SEVERITY_TICK_LABEL[n] ?? "";
            },
          },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: C.ink2,
            font: { family: MONO_FONT, size: 10 },
          },
        },
      },
    }),
    [],
  );

  // Height scales with row count so each bar gets reasonable breathing room
  // even when there are only 2-3 risks. Floor of 180 keeps short lists
  // from collapsing the card.
  const height = Math.max(180, rows.length * 36 + 60);

  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      <div className="text-base font-serif font-medium text-report-ink mb-1">
        {p.props.title}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-report-ink-3 italic mt-3">
          No risks identified.
        </div>
      ) : (
        <div style={{ height }}>
          <Bar data={data} options={options} />
        </div>
      )}
    </div>
  );
}
