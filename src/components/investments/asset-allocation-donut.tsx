"use client";
import { Fragment, useEffect, useRef } from "react";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import {
  colorForAssetClass,
  colorForAssetType,
  shadeForClassInType,
  UNALLOCATED_COLOR,
} from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";

ChartJS.register(ArcElement, Tooltip, Legend);

export type AssetAllocationDonutMode = "high_level" | "detailed" | "combined";

interface Props {
  household: HouseholdAllocation;
  mode: AssetAllocationDonutMode;
  showHeader?: boolean;
  size?: number; // donut diameter px, default 256
  onChartReady?: (canvas: HTMLCanvasElement) => void;
}

const options = {
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: { label: string; parsed: number }) =>
          `${ctx.label}: $${ctx.parsed.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      },
    },
  },
  cutout: "62%",
  maintainAspectRatio: true,
};

export function AssetAllocationDonut({
  household,
  mode,
  showHeader = true,
  size = 256,
  onChartReady,
}: Props) {
  const chartRef = useRef<ChartJS<"doughnut"> | null>(null);

  const unallocatedRow = household.unallocatedValue > 0
    ? { label: "Unallocated", value: household.unallocatedValue, color: UNALLOCATED_COLOR }
    : null;

  const datasets = buildDatasets(household, mode, unallocatedRow);

  useEffect(() => {
    if (!onChartReady) return;
    const canvas = chartRef.current?.canvas;
    if (canvas) onChartReady(canvas);
  }, [onChartReady, household, mode]);

  return (
    <div className="flex flex-col items-center gap-3">
      {showHeader && (
        <>
          <div className="text-xs uppercase tracking-wide text-gray-400">Investable Total</div>
          <div className="text-2xl font-bold text-gray-100">
            ${household.totalInvestableValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </>
      )}
      <div style={{ height: size, width: size }}>
        <Doughnut
          ref={chartRef}
          data={{ labels: datasets.labels, datasets: datasets.datasets }}
          options={options}
        />
      </div>
      <LegendView household={household} mode={mode} />
    </div>
  );
}

function buildDatasets(
  household: HouseholdAllocation,
  mode: AssetAllocationDonutMode,
  unallocated: { label: string; value: number; color: string } | null,
) {
  if (mode === "high_level") {
    const rows = [
      ...household.byAssetType.map((t) => ({
        label: t.label,
        value: t.value,
        color: colorForAssetType(t.id),
      })),
      ...(unallocated ? [unallocated] : []),
    ];
    return {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      }],
    };
  }

  if (mode === "detailed") {
    const rows = [
      ...household.byAssetClass.map((b) => ({
        label: b.name,
        value: b.value,
        color: colorForAssetClass({ sortOrder: b.sortOrder }),
      })),
      ...(unallocated ? [unallocated] : []),
    ];
    return {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      }],
    };
  }

  // combined — nested donut: inner ring = types, outer ring = classes
  // (class colors shaded within their type's hue).
  const typeRows = household.byAssetType.map((t) => ({
    label: t.label,
    value: t.value,
    color: colorForAssetType(t.id),
  }));
  const outerRows: { label: string; value: number; color: string }[] = [];
  for (const t of household.byAssetType) {
    const classes = household.byAssetClass
      .filter((c) => c.assetType === t.id)
      .sort((a, b) => b.value - a.value);
    classes.forEach((c, idx) => {
      outerRows.push({
        label: c.name,
        value: c.value,
        color: shadeForClassInType(t.id, idx, classes.length),
      });
    });
  }
  const innerWithUnalloc = unallocated ? [...typeRows, unallocated] : typeRows;
  const outerWithUnalloc = unallocated ? [...outerRows, unallocated] : outerRows;

  return {
    // Use outer ring labels for tooltips (more informative); inner ring shares
    // the same data points by weight so the tooltip index still resolves.
    labels: outerWithUnalloc.map((r) => r.label),
    datasets: [
      {
        // Outer ring = classes
        data: outerWithUnalloc.map((r) => r.value),
        backgroundColor: outerWithUnalloc.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      },
      {
        // Inner ring = types
        data: innerWithUnalloc.map((r) => r.value),
        backgroundColor: innerWithUnalloc.map((r) => r.color),
        borderColor: "#111827",
        borderWidth: 2,
      },
    ],
  };
}

export function LegendView({ household, mode }: { household: HouseholdAllocation; mode: AssetAllocationDonutMode }) {
  if (mode === "high_level") {
    return (
      <ul className="mt-2 flex w-full flex-col gap-1 text-xs">
        {household.byAssetType.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: colorForAssetType(t.id) }}
            />
            <span className="text-gray-200">{t.label}</span>
            <span className="ml-auto tabular-nums text-gray-400">
              {(t.pctOfClassified * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (mode === "detailed") {
    return (
      <ul className="mt-2 flex w-full flex-col gap-1 text-xs">
        {household.byAssetClass.map((b) => (
          <li key={b.id} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: colorForAssetClass({ sortOrder: b.sortOrder }) }}
            />
            <span className="text-gray-200">{b.name}</span>
            <span className="ml-auto tabular-nums text-gray-400">
              {(b.pctOfClassified * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    );
  }

  // combined — type heading + nested class rows
  return (
    <div className="mt-2 flex w-full flex-col gap-2 text-xs">
      {household.byAssetType.map((t) => {
        const classes = household.byAssetClass
          .filter((c) => c.assetType === t.id)
          .sort((a, b) => b.value - a.value);
        return (
          <Fragment key={t.id}>
            <div>
              <div className="flex items-center gap-2 font-semibold text-gray-200">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: colorForAssetType(t.id) }}
                />
                <span>{t.label}</span>
                <span className="ml-auto tabular-nums text-gray-400">
                  {(t.pctOfClassified * 100).toFixed(1)}%
                </span>
              </div>
              <ul className="ml-4 mt-1 flex flex-col gap-1">
                {classes.map((c, idx) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ backgroundColor: shadeForClassInType(t.id, idx, classes.length) }}
                    />
                    <span className="text-gray-300">{c.name}</span>
                    <span className="ml-auto tabular-nums text-gray-400">
                      {(c.pctOfClassified * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
