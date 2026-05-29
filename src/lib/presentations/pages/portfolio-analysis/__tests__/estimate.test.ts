import { describe, it, expect } from "vitest";
import { estimatePortfolioAnalysisPageCount } from "../estimate-page-count";
import type { PortfolioAnalysisData } from "../view-model";

const make = (n: number): PortfolioAnalysisData => ({
  scatter: { kind: "scatter", width: 360, height: 300, margin: { top: 0, right: 0, bottom: 0, left: 0 },
    gridlineColor: "#000", xAxis: { domain: [0, 1], ticks: [], labelFormat: String, title: "" },
    yAxis: { domain: [0, 1], ticks: [], labelFormat: String, title: "" }, points: [], legend: { items: [] } },
  tableRows: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, name: `N${i}`, type: "asset_class" as const, geometricReturn: 0, arithmeticMean: 0, stdDev: 0, sharpe: null, value: null })),
  unplottable: [],
});

describe("estimatePortfolioAnalysisPageCount", () => {
  it("is two pages for the typical scatter + table", () => {
    expect(estimatePortfolioAnalysisPageCount(make(10))).toBe(2);
  });
  it("adds a page for a very long table", () => {
    expect(estimatePortfolioAnalysisPageCount(make(60))).toBe(3);
  });
});
