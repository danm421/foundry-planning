import { describe, it, expect } from "vitest";
import { buildCashFlowChartSpec } from "../cashflow-chart-spec";
import type { CashFlowTableRow, TableMarker } from "../../types";
import { dataLight, colorsLight } from "@/brand";

const rows: CashFlowTableRow[] = [
  { year: 2031, ageClient: 65, ageSpouse: 61, cells: {
      salary: 0, socialSecurity: 30_000, otherInflows: 5_000,
      rmds: 40_000, withdrawals: 40_000,
      totalIncome: 75_000, expenses: 130_000, savings: 0, totalExpenses: 130_000,
      netCashFlow: -55_000, portfolioGrowth: 0, portfolioActivity: 0,
      portfolioAssets: 1_400_000 } },
  { year: 2036, ageClient: 70, ageSpouse: 66, cells: {
      salary: 0, socialSecurity: 33_000, otherInflows: 7_000,
      rmds: 60_000, withdrawals: 40_000,
      totalIncome: 100_000, expenses: 140_000, savings: 0, totalExpenses: 140_000,
      netCashFlow: -40_000, portfolioGrowth: 0, portfolioActivity: 0,
      portfolioAssets: 1_310_000 } },
];

const markers: TableMarker[] = [
  { year: 2031, kind: "retirement", who: "client", label: "Cooper — Retirement" },
];

describe("buildCashFlowChartSpec", () => {
  const spec = buildCashFlowChartSpec({ rows, markers });

  it("declares dimensions and margins", () => {
    expect(spec.kind).toBe("stackedBarWithLine");
    expect(spec.width).toBeGreaterThan(0);
    expect(spec.height).toBeGreaterThan(0);
    expect(spec.margin.left).toBeGreaterThan(0);
  });

  it("derives x-axis domain from row years", () => {
    expect(spec.xAxis.domain).toEqual([2031, 2036]);
  });

  it("emits 5 stack series matching the in-app chart order with hex colors", () => {
    expect(spec.stacks.map((s) => s.seriesId)).toEqual([
      "ss", "salary", "otherInflows", "rmd", "withdrawals",
    ]);
    expect(spec.stacks[0].color).toBe(dataLight.blue);   // social security
    expect(spec.stacks[1].color).toBe(dataLight.green);  // salaries
    expect(spec.stacks[2].color).toBe(dataLight.teal);   // other inflows
    expect(spec.stacks[3].color).toBe(dataLight.orange); // rmds
    expect(spec.stacks[4].color).toBe(dataLight.red);    // withdrawals
  });

  it("emits the expenses line", () => {
    expect(spec.lines).toHaveLength(1);
    expect(spec.lines[0].seriesId).toBe("totalExpenses");
    expect(spec.lines[0].color).toBe(colorsLight.ink);
    expect(spec.lines[0].values).toEqual([130_000, 140_000]);
  });

  it("scales y-domain to max stack total", () => {
    // 2031 stack total = 0+30000+5000+40000+40000 = 115000
    // 2036 stack total = 0+33000+7000+60000+40000 = 140000
    // Expenses peak: max(130000, 140000) = 140000
    // domain max should be max(stack max, line max) with headroom
    expect(spec.yAxis.domain[0]).toBe(0);
    expect(spec.yAxis.domain[1]).toBeGreaterThanOrEqual(140_000);
  });

  it("passes through markers with iconKind preserved", () => {
    expect(spec.markers).toHaveLength(1);
    expect(spec.markers[0]).toMatchObject({
      atX: 2031,
      iconKind: "retirement",
      label: "Cooper — Retirement",
    });
  });

  it("emits legend items with kinds", () => {
    const legendKinds = spec.legend.items.map((i) => i.kind);
    expect(legendKinds.filter((k) => k === "swatch")).toHaveLength(5);
    expect(legendKinds.filter((k) => k === "line")).toHaveLength(1);
  });
});

// F76: short year ranges (≤5 years) make d3.ticks emit half-integer ticks
// (e.g. 2026.5) that the scaleBand renderer can't place, pinning every label
// to the leftmost bar. Ticks must be integer years present in the domain.
describe("buildCashFlowChartSpec — x-axis ticks (F76)", () => {
  const shortRows: CashFlowTableRow[] = [2026, 2027, 2028].map((year) => ({
    year,
    ageClient: null,
    ageSpouse: null,
    cells: {
      salary: 0, socialSecurity: 0, otherInflows: 0, rmds: 0, withdrawals: 0,
      totalIncome: 0, expenses: 0, savings: 0, totalExpenses: 0,
      netCashFlow: 0, portfolioGrowth: 0, portfolioActivity: 0, portfolioAssets: 0,
    },
  }));

  it("emits only integer year ticks that exist in the domain", () => {
    const spec = buildCashFlowChartSpec({ rows: shortRows, markers: [] });
    expect(spec.xAxis.ticks.length).toBeGreaterThan(0);
    expect(spec.xAxis.ticks.every((t) => Number.isInteger(t))).toBe(true);
    expect(spec.xAxis.ticks.every((t) => spec.xAxis.domain.includes(t))).toBe(true);
  });
});
