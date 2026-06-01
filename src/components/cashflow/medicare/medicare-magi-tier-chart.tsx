"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { Line } from "react-chartjs-2";
import type { ChartOptions, ChartData } from "chart.js";
import type { ProjectionYear } from "@/engine";
import { chartChrome, useThemeName } from "@/lib/chart-colors";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  annotationPlugin,
);

interface Props {
  years: ProjectionYear[];
  yearRange: [number, number];
}

// Semi-transparent washes for tier annotation bands — escalate in warmth with tier severity.
// Using rgba values directly since chartjs-plugin-annotation needs string color values.
const TIER_LABEL_COLORS = [
  "rgba(250,204,21,0.10)",  // tier 1 — wheat wash
  "rgba(249,115,22,0.12)",  // tier 2 — terra wash
  "rgba(239,68,68,0.12)",   // tier 3 — rose/crit wash
  "rgba(220,38,38,0.14)",   // tier 4 — deeper crit wash
  "rgba(127,29,29,0.16)",   // tier 5 — darkest crit wash
];

export function MedicareMagiTierChart({ years, yearRange }: Props) {
  const theme = useThemeName();
  const filtered = useMemo(
    () => years.filter(y => y.year >= yearRange[0] && y.year <= yearRange[1]),
    [years, yearRange],
  );

  // Pull filing status from the first year that has Medicare data.
  const sample = filtered.find(y => y.medicare?.client || y.medicare?.spouse);
  const filingStatus = sample?.medicare?.client?.irmaaFilingStatus
    ?? sample?.medicare?.spouse?.irmaaFilingStatus
    ?? "mfj";

  // Derive tier thresholds from sourceMagi + headroomToNextTier across filtered years.
  // Skip Infinity (person is already in the top tier that year).
  const tierThresholds: number[] = useMemo(() => {
    const set = new Set<number>();
    for (const y of filtered) {
      const d = y.medicare?.client ?? y.medicare?.spouse;
      if (!d || d.headroomToNextTier === Infinity) continue;
      set.add(Math.round(d.sourceMagi + d.headroomToNextTier));
    }
    return [...set].sort((a, b) => a - b).slice(0, 5);
  }, [filtered]);

  const chrome = chartChrome(theme);

  const data: ChartData<"line"> = {
    labels: filtered.map(y => y.year.toString()),
    datasets: [
      {
        label: "Source-year MAGI",
        data: filtered.map(
          y => y.medicare?.client?.sourceMagi ?? y.medicare?.spouse?.sourceMagi ?? null,
        ),
        borderColor: "var(--color-data-indigo)",
        backgroundColor: "rgba(99,102,241,0.10)",
        tension: 0.2,
        pointRadius: 3,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: "index",
        intersect: false,
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
      },
      annotation: tierThresholds.length > 0
        ? {
            annotations: Object.fromEntries(
              tierThresholds.map((t, idx) => [
                `tier${idx + 1}`,
                {
                  type: "line" as const,
                  yMin: t,
                  yMax: t,
                  borderColor: chrome.grid,
                  borderWidth: 1,
                  borderDash: [4, 4],
                  label: {
                    display: true,
                    content: `Tier ${idx + 1} ($${(t / 1000).toFixed(0)}k ${filingStatus})`,
                    position: "end" as const,
                    backgroundColor: TIER_LABEL_COLORS[idx],
                    color: chrome.tick,
                    font: { size: 10 },
                  },
                },
              ]),
            ),
          }
        : undefined,
    },
    scales: {
      x: {
        ticks: { color: chrome.tick },
        grid: { color: chrome.grid },
      },
      y: {
        ticks: {
          color: chrome.tick,
          callback: (v) => `$${Math.round(Number(v) / 1000)}k`,
        },
        grid: { color: chrome.grid },
      },
    },
  };

  return (
    <div className="h-72 w-full">
      <Line data={data} options={options} />
    </div>
  );
}
