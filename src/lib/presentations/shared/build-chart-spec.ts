// Generic stacked-bar ChartSpec builder for drill-down pages. Mirrors the
// math in charts/cashflow-chart-spec.ts but takes the stacks and optional
// line overlay as inputs (no hard-coded series ids).

import { extent, ticks } from "d3-array";
import type { ChartSpec } from "../charts/types";
import type { TableMarker } from "../types";
import { PRESENTATION_THEME } from "../theme";
import { compactCurrency } from "../format";

export interface DrillStackSeries {
  seriesId: string;
  label: string;
  color: string;
  values: number[];  // one per year in `years`
}

export interface DrillLineSeries {
  seriesId: string;
  label: string;
  color: string;
  strokeWidth?: number;
  values: number[];
}

export interface BuildDrillChartSpecInput {
  years: number[];
  stacks: DrillStackSeries[];
  lines?: DrillLineSeries[];
  markers: TableMarker[];
}

export function buildDrillChartSpec(
  input: BuildDrillChartSpecInput,
): ChartSpec {
  const { years, stacks, lines = [], markers } = input;

  const width = 540;
  const height = 260;
  const margin = { top: 24, right: 16, bottom: 56, left: 64 };

  const xDomain = years;
  const xExtent = extent(years) as [number, number];
  // F76: the renderer places ticks on a scaleBand over integer years, so any
  // fractional tick d3 emits for short ranges (e.g. 2026.5 from a 3-year span)
  // resolves to undefined → pinned to the leftmost bar. Keep only integer years
  // that exist in the domain.
  const xTicks =
    xExtent[0] === undefined
      ? []
      : ticks(xExtent[0], xExtent[1], 6).filter(
          (t) => Number.isInteger(t) && years.includes(t),
        );

  const specStacks: ChartSpec["stacks"] = stacks.map((s) => ({
    seriesId: s.seriesId,
    label: s.label,
    color: s.color,
    values: s.values,
  }));

  const specLines: ChartSpec["lines"] = lines.map((ln) => ({
    seriesId: ln.seriesId,
    label: ln.label,
    color: ln.color,
    strokeWidth: ln.strokeWidth ?? 1.5,
    values: ln.values,
  }));

  // Per-year positive and negative stack subtotals (separate, so diverging
  // bars get a symmetric-ish domain). For all-positive data negTotals are 0.
  const posTotals = years.map((_, i) =>
    stacks.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0),
  );
  const negTotals = years.map((_, i) =>
    stacks.reduce((sum, s) => sum + Math.min(0, s.values[i] ?? 0), 0),
  );
  const allLineValues = specLines.flatMap((ln) => ln.values);

  const candidateMax = Math.max(0, ...posTotals, ...allLineValues, 1);
  const candidateMin = Math.min(0, ...negTotals, ...allLineValues);

  const yDomainMax = niceCeiling(candidateMax * 1.05);
  const yDomainMin = candidateMin < 0 ? -niceCeiling(-candidateMin * 1.05) : 0;
  const yTicks = ticks(yDomainMin, yDomainMax, 6);

  const specMarkers: ChartSpec["markers"] = markers.map((m) => ({
    atX: m.year,
    label: m.label,
    color:
      m.kind === "retirement"
        ? PRESENTATION_THEME.accent
        : PRESENTATION_THEME.ink3,
    iconKind: m.kind,
  }));

  const legendItems: ChartSpec["legend"]["items"] = [
    ...specStacks.map((s) => ({
      label: s.label,
      color: s.color,
      kind: "swatch" as const,
    })),
    ...specLines.map((ln) => ({
      label: ln.label,
      color: ln.color,
      kind: "line" as const,
    })),
  ];

  return {
    kind: "stackedBarWithLine",
    width,
    height,
    margin,
    xAxis: {
      domain: xDomain,
      ticks: xTicks,
      labelFormat: (v: number) => String(v),
    },
    yAxis: {
      domain: [yDomainMin, yDomainMax],
      ticks: yTicks,
      labelFormat: (v: number) => compactCurrency(v),
      gridlineColor: PRESENTATION_THEME.hair,
    },
    stacks: specStacks,
    lines: specLines,
    markers: specMarkers,
    legend: { position: "bottom", items: legendItems },
  };
}

function niceCeiling(v: number): number {
  if (v <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / magnitude) * magnitude;
}
