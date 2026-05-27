import { describe, it, expect } from "vitest";
import { buildCashFlowChartSpec } from "../cashflow-chart-spec";
import type { CashFlowTableRow, TableMarker } from "../../types";

const rows: CashFlowTableRow[] = [
  { year: 2031, ageClient: 65, ageSpouse: 61, cells: {
      totalExpenses: 130_000, salary: 0, socialSecurity: 30_000, otherIncome: 5_000,
      rmds: 40_000, withdrawals: 40_000, totalWithdrawalsSpent: 80_000,
      netSavings: 0, totalPortfolioAssets: 1_400_000 } },
  { year: 2036, ageClient: 70, ageSpouse: 66, cells: {
      totalExpenses: 140_000, salary: 0, socialSecurity: 33_000, otherIncome: 7_000,
      rmds: 60_000, withdrawals: 40_000, totalWithdrawalsSpent: 100_000,
      netSavings: 0, totalPortfolioAssets: 1_310_000 } },
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

  it("emits 5 stack series in correct order with hex colors", () => {
    expect(spec.stacks.map((s) => s.seriesId)).toEqual([
      "salary", "ss", "otherIncome", "rmd", "withdrawals",
    ]);
    expect(spec.stacks[0].color).toBe("#3b6ea3"); // salary = steel
    expect(spec.stacks[1].color).toBe("#b87f1f"); // ss = accent
    expect(spec.stacks[2].color).toBe("#2f6b4a"); // other income = good
    expect(spec.stacks[3].color).toBe("#d4a86a"); // rmd = accentMuted
    expect(spec.stacks[4].color).toBe("#5a5a60"); // withdrawals = ink2
  });

  it("emits the expenses line", () => {
    expect(spec.lines).toHaveLength(1);
    expect(spec.lines[0].seriesId).toBe("totalExpenses");
    expect(spec.lines[0].color).toBe("#a13a3a");
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
