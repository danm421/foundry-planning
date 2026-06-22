// src/components/portal/networth-trend-chart.tsx
"use client";
import { useMemo, useState, type ReactElement } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement,
  Filler, Tooltip, Legend, type ChartOptions,
} from "chart.js";
import { useThemeName, chartChrome, dataPalette } from "@/lib/chart-colors";
import {
  sliceSeriesToWindow, type TrendPoint, type TrendWindow,
} from "@/lib/portal/networth-trend";
import { fmtUsd } from "@/lib/portal/format";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);

const WINDOWS: TrendWindow[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];

export function NetWorthTrendChart({
  series, asOfDate,
}: { series: TrendPoint[]; asOfDate: string }): ReactElement | null {
  const [win, setWin] = useState<TrendWindow>("1Y");
  const theme = useThemeName();
  const chrome = chartChrome(theme);
  const pal = dataPalette(theme);

  const points = useMemo(
    () => sliceSeriesToWindow(series, win, asOfDate),
    [series, win, asOfDate],
  );

  if (series.length < 2) return null;

  const data = {
    labels: points.map((p) => p.date),
    datasets: [
      {
        label: "Net worth",
        data: points.map((p) => p.netWorth),
        borderColor: pal.blue,
        backgroundColor: `${pal.blue}22`,
        borderWidth: 2,
        pointRadius: 0,
        fill: "origin" as const,
        tension: 0.2,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: chrome.tooltipBg,
        titleColor: chrome.tooltipTitle,
        bodyColor: chrome.tooltipBody,
        callbacks: { label: (c) => fmtUsd(Number(c.parsed.y)) },
      },
    },
    scales: {
      x: { ticks: { color: chrome.tick, maxTicksLimit: 6 }, grid: { display: false } },
      y: { ticks: { color: chrome.tick, callback: (v) => fmtUsd(Number(v)) },
           grid: { color: chrome.grid } },
    },
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-2">Net worth trend</h3>
        <div className="flex gap-1" role="group" aria-label="Chart time window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={w === win}
              onClick={() => setWin(w)}
              className={`rounded-md border px-2.5 py-1 text-[12px] font-medium ${
                w === win
                  ? "border-accent bg-card-2 text-accent"
                  : "border-transparent text-ink-3 hover:bg-card-2"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className="h-56">
        <Line data={data} options={options} />
      </div>
    </section>
  );
}
