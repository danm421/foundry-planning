import { extent, ticks } from "d3-array";
import { niceAxisMax, axisTicks, bandLabelIndices } from "./axis";
import type { CashFlowTableRow, TableMarker } from "../types";
import type { ChartSpec } from "./types";
import { PRESENTATION_THEME } from "../theme";
import { compactCurrency } from "../format";

export interface BuildCashFlowChartSpecInput {
  rows: CashFlowTableRow[];
  markers: TableMarker[];
}

export function buildCashFlowChartSpec(
  input: BuildCashFlowChartSpecInput,
): ChartSpec {
  const { rows, markers } = input;

  const width = 540;
  const height = 260;
  const margin = { top: 24, right: 16, bottom: 56, left: 64 };

  // X-axis: years from rows.
  const years = rows.map((r) => r.year);
  const xDomain = years;
  const xExtent = extent(years) as [number, number];
  // F76: the renderer places ticks on a scaleBand over integer years, so any
  // fractional tick d3 emits for short ranges (e.g. 2026.5 from a 3-year span)
  // resolves to undefined → pinned to the leftmost bar. Keep only integer years
  // that exist in the domain.
  const evenTicks =
    xExtent[0] === undefined
      ? []
      : ticks(xExtent[0], xExtent[1], 6).filter(
          (t) => Number.isInteger(t) && years.includes(t),
        );
  // The evenly spaced run stops wherever d3 leaves it, so a 2055-2084 chart
  // labelled up to 2080 and left its last four bars unnamed. Pin the final
  // year and drop any regular label that would collide with it.
  const everyBands =
    evenTicks.length > 1
      ? Math.max(1, years.indexOf(evenTicks[1]) - years.indexOf(evenTicks[0]))
      : Math.max(1, years.length);
  const xTicks = bandLabelIndices(years.length, {
    every: everyBands,
    minGap: 2,
    pinned: evenTicks.map((t) => years.indexOf(t)),
  })
    .map((i) => years[i])
    .filter((y): y is number => y !== undefined);

  // Stacks bottom→top, matching the in-app Cash Flow chart.
  // chartStack order is [SS, Salaries, Other Inflows, RMDs, Withdrawals].
  const stacks: ChartSpec["stacks"] = [
    { seriesId: "ss", label: "Social Security",
      color: PRESENTATION_THEME.chartStack[0],
      values: rows.map((r) => r.cells.socialSecurity) },
    { seriesId: "salary", label: "Salaries",
      color: PRESENTATION_THEME.chartStack[1],
      values: rows.map((r) => r.cells.salary) },
    { seriesId: "otherInflows", label: "Other Inflows",
      color: PRESENTATION_THEME.chartStack[2],
      values: rows.map((r) => r.cells.otherInflows) },
    { seriesId: "rmd", label: "RMDs",
      color: PRESENTATION_THEME.chartStack[3],
      values: rows.map((r) => r.cells.rmds) },
    { seriesId: "withdrawals", label: "Withdrawals",
      color: PRESENTATION_THEME.chartStack[4],
      values: rows.map((r) => r.cells.withdrawals) },
  ];

  const lines: ChartSpec["lines"] = [
    { seriesId: "totalExpenses", label: "Total Expenses",
      color: PRESENTATION_THEME.chartLine,
      strokeWidth: 1.5,
      values: rows.map((r) => r.cells.totalExpenses) },
  ];

  // Y-axis: max of (stack totals, expense line).
  const stackTotals = rows.map((_, i) =>
    stacks.reduce((sum, s) => sum + s.values[i], 0),
  );
  const expenseMax = Math.max(0, ...lines[0].values);
  const yMax = Math.max(expenseMax, ...stackTotals, 1);
  const yDomainMax = niceAxisMax(yMax * 1.05);
  const yTicks = axisTicks(yDomainMax);

  // Markers — colors resolved here.
  const specMarkers: ChartSpec["markers"] = markers.map((m) => ({
    atX: m.year,
    label: m.label,
    color: m.kind === "retirement"
      ? PRESENTATION_THEME.accent
      : PRESENTATION_THEME.ink3,
    iconKind: m.kind,
  }));

  // Legend — one swatch per stack + one line for expenses.
  const legendItems: ChartSpec["legend"]["items"] = [
    ...stacks.map((s) => ({ label: s.label, color: s.color, kind: "swatch" as const })),
    { label: lines[0].label, color: lines[0].color, kind: "line" as const },
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
      domain: [0, yDomainMax],
      ticks: yTicks,
      labelFormat: (v: number) => compactCurrency(v),
      gridlineColor: PRESENTATION_THEME.hair,
    },
    stacks,
    lines,
    markers: specMarkers,
    legend: { position: "bottom", items: legendItems },
  };
}

