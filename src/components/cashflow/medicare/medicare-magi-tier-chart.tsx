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

const TIER_LABEL_COLORS = [
  "rgba(250,204,21,0.10)",  // tier 1 (yellow)
  "rgba(249,115,22,0.12)",  // tier 2 (orange)
  "rgba(239,68,68,0.12)",   // tier 3 (red)
  "rgba(220,38,38,0.14)",   // tier 4 (dark red)
  "rgba(127,29,29,0.16)",   // tier 5 (deeper red)
];

export function MedicareMagiTierChart({ years, yearRange }: Props) {
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

  const data: ChartData<"line"> = {
    labels: filtered.map(y => y.year.toString()),
    datasets: [
      {
        label: "Source-year MAGI",
        data: filtered.map(
          y => y.medicare?.client?.sourceMagi ?? y.medicare?.spouse?.sourceMagi ?? null,
        ),
        borderColor: "rgb(59,130,246)",
        backgroundColor: "rgba(59,130,246,0.10)",
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
      tooltip: { mode: "index", intersect: false },
      annotation: tierThresholds.length > 0
        ? {
            annotations: Object.fromEntries(
              tierThresholds.map((t, idx) => [
                `tier${idx + 1}`,
                {
                  type: "line" as const,
                  yMin: t,
                  yMax: t,
                  borderColor: "rgba(0,0,0,0.18)",
                  borderWidth: 1,
                  borderDash: [4, 4],
                  label: {
                    display: true,
                    content: `Tier ${idx + 1} ($${(t / 1000).toFixed(0)}k ${filingStatus})`,
                    position: "end" as const,
                    backgroundColor: TIER_LABEL_COLORS[idx],
                    color: "#000",
                    font: { size: 10 },
                  },
                },
              ]),
            ),
          }
        : undefined,
    },
    scales: {
      y: {
        ticks: { callback: (v) => `$${Math.round(Number(v) / 1000)}k` },
      },
    },
  };

  return (
    <div className="h-72 w-full">
      <Line data={data} options={options} />
    </div>
  );
}
