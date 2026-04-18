"use client";

import { useMemo, useRef, useEffect } from "react";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
} from "chart.js";
import type { BalanceSheetViewModel } from "./view-model";
import { SCREEN_THEME } from "./tokens";
import type { YoyResult } from "./yoy";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function YoyBadge({ yoy }: { yoy: YoyResult | null }) {
  if (yoy == null) return null;
  const cls = SCREEN_THEME.status[yoy.badge];
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {arrow} {sign}{yoy.value.toFixed(1)}%
    </span>
  );
}

interface CenterColumnProps {
  viewModel: BalanceSheetViewModel;
  /** Refs to the donut + bar chart canvases, used for PDF export capture. */
  donutCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  barCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function CenterColumn({
  viewModel,
  donutCanvasRef,
  barCanvasRef,
}: CenterColumnProps) {
  const donutData = useMemo(() => ({
    labels: viewModel.donut.map((s) => s.label),
    datasets: [{
      data: viewModel.donut.map((s) => s.value),
      backgroundColor: viewModel.donut.map((s) => s.hex),
      borderWidth: 0,
    }],
  }), [viewModel.donut]);

  const barData = useMemo(() => ({
    labels: viewModel.barChartSeries.map((p) => String(p.year)),
    datasets: [
      {
        label: "Total Assets",
        data: viewModel.barChartSeries.map((p) => p.assets),
        backgroundColor: "#3b82f6",
      },
      {
        label: "Total Liabilities",
        data: viewModel.barChartSeries.map((p) => p.liabilities),
        backgroundColor: "#f59e0b",
      },
    ],
  }), [viewModel.barChartSeries]);

  const donutRef = useRef<ChartJS<"doughnut"> | null>(null);
  const barRef = useRef<ChartJS<"bar"> | null>(null);

  // Expose canvas elements via the provided refs for PDF capture.
  useEffect(() => {
    if (donutRef.current && donutCanvasRef) {
      (donutCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current =
        donutRef.current.canvas;
    }
    if (barRef.current && barCanvasRef) {
      (barCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current =
        barRef.current.canvas;
    }
  });

  return (
    <div className="flex flex-col gap-4">
      <div className={`${SCREEN_THEME.surface.panel} p-5`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Total Assets
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="text-3xl font-bold text-gray-100">
            {formatCurrency(viewModel.totalAssets)}
          </div>
          <YoyBadge yoy={viewModel.yoy.totalAssets} />
        </div>
        {viewModel.donut.length > 0 && (
          <div className="mt-4 h-64">
            <Doughnut
              ref={donutRef}
              data={donutData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: "right",
                    labels: { color: "#9ca3af", boxWidth: 12, font: { size: 11 } },
                  },
                },
              }}
            />
          </div>
        )}
      </div>

      <div className={`${SCREEN_THEME.surface.panel} p-5`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Assets vs Liabilities
        </div>
        <div className="mt-3 h-48">
          <Bar
            ref={barRef}
            data={barData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  labels: { color: "#9ca3af", boxWidth: 12, font: { size: 11 } },
                },
              },
              scales: {
                x: { ticks: { color: "#9ca3af" }, grid: { display: false } },
                y: {
                  ticks: {
                    color: "#9ca3af",
                    callback: (v) => `$${(Number(v) / 1000).toFixed(0)}k`,
                  },
                  grid: { color: "rgba(75,85,99,0.2)" },
                },
              },
            }}
          />
        </div>
      </div>

      {(viewModel.outOfEstateRows.length > 0 ||
        viewModel.outOfEstateLiabilityRows.length > 0) && (
        <div className={SCREEN_THEME.surface.panel}>
          <div className={`${SCREEN_THEME.surface.panelHeader} flex items-center justify-between`}>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Out of Estate
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                Net
              </span>
              <span className="text-sm font-semibold text-gray-100">
                {formatCurrency(viewModel.outOfEstateNetWorth)}
              </span>
            </div>
          </div>
          {viewModel.outOfEstateRows.length > 0 && (
            <div className="px-4 pb-2 pt-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Assets
                </span>
                <span className="text-xs font-semibold text-emerald-400">
                  {formatCurrency(
                    viewModel.outOfEstateRows.reduce((s, r) => s + r.value, 0),
                  )}
                </span>
              </div>
              {viewModel.outOfEstateRows.map((row) => (
                <div
                  key={row.accountId}
                  className="flex items-center justify-between border-b border-gray-800/60 py-1 last:border-b-0"
                >
                  <span className="text-sm text-gray-300">{row.accountName}</span>
                  <span className="text-sm text-gray-200">{formatCurrency(row.value)}</span>
                </div>
              ))}
            </div>
          )}
          {viewModel.outOfEstateLiabilityRows.length > 0 && (
            <div className="border-t border-gray-800 px-4 pb-3 pt-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Liabilities
                </span>
                <span className="text-xs font-semibold text-rose-400">
                  −{formatCurrency(
                    viewModel.outOfEstateLiabilityRows.reduce((s, r) => s + r.balance, 0),
                  )}
                </span>
              </div>
              {viewModel.outOfEstateLiabilityRows.map((row) => (
                <div
                  key={row.liabilityId}
                  className="flex items-center justify-between border-b border-gray-800/60 py-1 last:border-b-0"
                >
                  <span className="text-sm text-gray-300">{row.liabilityName}</span>
                  <span className="text-sm text-gray-200">
                    −{formatCurrency(row.balance)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
