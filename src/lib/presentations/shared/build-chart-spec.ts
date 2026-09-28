// Generic stacked-bar ChartSpec builder for drill-down pages. Mirrors the
// math in charts/cashflow-chart-spec.ts but takes the stacks and optional
// line overlay as inputs (no hard-coded series ids).

import { extent, ticks } from "d3-array";
import type { ChartSpec } from "../charts/types";
import type { TableMarker } from "../types";
import { PRESENTATION_THEME } from "../theme";
import { compactCurrency } from "../format";
import { niceAxisMax } from "../charts/axis";

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
  /** An explicit axis ceiling, when the page's own model already chose one
   *  (the Tax Bracket sheet shares the screen chart's, so a reference line
   *  that runs off the top of one chart runs off the top of the other). The
   *  caller is responsible for the data fitting under it. Omitted → sized
   *  from the data. */
  yMax?: number;
  /** Canvas size and margins, for a chart that shares its sheet with other
   *  panels. Omitted → the full-width drill chart. */
  frame?: Pick<ChartSpec, "width" | "height" | "margin">;
}

const DRILL_FRAME: Pick<ChartSpec, "width" | "height" | "margin"> = {
  width: 540,
  height: 260,
  margin: { top: 24, right: 16, bottom: 56, left: 64 },
};

export function buildDrillChartSpec(
  input: BuildDrillChartSpecInput,
): ChartSpec {
  const { years, stacks, lines = [], markers } = input;
  const { width, height, margin } = input.frame ?? DRILL_FRAME;

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
  // A NaN in a line is a gap (ChartSpec.lines), not a value; it must not poison
  // the axis.
  const allLineValues = specLines.flatMap((ln) => ln.values).filter(Number.isFinite);

  const candidateMax = Math.max(0, ...posTotals, ...allLineValues, 1);
  const candidateMin = Math.min(0, ...negTotals, ...allLineValues);

  const yDomainMax = input.yMax != null && input.yMax > 0
    ? input.yMax
    : niceAxisMax(candidateMax * 1.05);
  const yDomainMin = candidateMin < 0 ? -niceAxisMax(-candidateMin * 1.05) : 0;
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

