import type { ChartSpec } from "./types";

// Stub — full implementation in Task 8.
export function buildCashFlowChartSpec(_input: unknown): ChartSpec {
  return {
    kind: "stackedBarWithLine",
    width: 0,
    height: 0,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    xAxis: { domain: [], ticks: [], labelFormat: (v) => String(v) },
    yAxis: { domain: [0, 0], ticks: [], labelFormat: (v) => String(v), gridlineColor: "#000" },
    stacks: [],
    lines: [],
    markers: [],
    legend: { position: "bottom", items: [] },
  };
}
