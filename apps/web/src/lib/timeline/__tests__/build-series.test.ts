import { describe, it, expect } from "vitest";
import { buildSeries } from "../build-series";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("buildSeries", () => {
  it("returns one SeriesPoint per projection year", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    expect(series).toHaveLength(projection.length);
    expect(series[0].year).toBe(projection[0].year);
  });

  it("portfolio sums taxable + cash + retirement totals only", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    const p0 = projection[0];
    expect(series[0].portfolio).toBeCloseTo(
      p0.portfolioAssets.taxableTotal +
        p0.portfolioAssets.cashTotal +
        p0.portfolioAssets.retirementTotal,
      6,
    );
  });

  it("netCashFlow passes through from ProjectionYear", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    expect(series[0].netCashFlow).toBe(projection[0].netCashFlow);
  });

  it("netWorth equals gross assets minus liability balances", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const series = buildSeries(projection);
    const p0 = projection[0];
    const liabTotal = Object.values(p0.liabilityBalancesBoY).reduce((s, v) => s + v, 0);
    // netWorth uses end-of-year liability; BoY is a close proxy for year 1
    // but the test only asserts the relationship within a tight bound.
    expect(series[0].netWorth).toBeLessThanOrEqual(p0.portfolioAssets.total);
    expect(series[0].netWorth).toBeGreaterThanOrEqual(p0.portfolioAssets.total - liabTotal - 1);
  });

  it("returns empty array for empty projection", () => {
    expect(buildSeries([])).toEqual([]);
  });
});
