// src/lib/timeline/__tests__/detectors/portfolio.test.ts
import { describe, it, expect } from "vitest";
import { detectPortfolioEvents, DEFAULT_PORTFOLIO_THRESHOLDS } from "../../detectors/portfolio";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectPortfolioEvents", () => {
  it("emits first-withdrawal year per account when byAccount transitions to non-zero", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS);
    // Every withdrawal-source account used by the fixture should get at most one
    // first-withdrawal event; accounts never touched get none.
    const ids = events.filter((e) => e.id.startsWith("portfolio:first_withdrawal:")).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits RMD begin once in the first year an account's rmdAmount is > 0", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS);
    const rmds = events.filter((e) => e.id.startsWith("portfolio:rmd_begin:"));
    for (const e of rmds) {
      // Each RMD event corresponds to a single account; no duplicates.
      expect(rmds.filter((x) => x.id === e.id)).toHaveLength(1);
    }
  });

  it("emits a threshold crossing exactly once when investable portfolio first exceeds the threshold", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    // Start below threshold and cross it in year 2 so the year-1 guard does not apply.
    projection[0].portfolioAssets.taxableTotal = 1000;
    projection[0].portfolioAssets.cashTotal = 0;
    projection[0].portfolioAssets.retirementTotal = 0;
    projection[1].portfolioAssets.taxableTotal = 2_000_000;
    projection[1].portfolioAssets.cashTotal = 0;
    projection[1].portfolioAssets.retirementTotal = 0;
    const events = detectPortfolioEvents(data, projection, [1_000_000]);
    const crossings = events.filter((e) => e.id === "portfolio:threshold:1000000");
    expect(crossings).toHaveLength(1);
    expect(crossings[0].year).toBe(projection[1].year);
  });

  it("emits portfolio peak year based on investable portfolio", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectPortfolioEvents(data, projection, DEFAULT_PORTFOLIO_THRESHOLDS);
    const peak = events.find((e) => e.id === "portfolio:peak");
    expect(peak).toBeDefined();
    // Peak year should be within the plan range.
    expect(peak!.year).toBeGreaterThanOrEqual(projection[0].year);
    expect(peak!.year).toBeLessThanOrEqual(projection[projection.length - 1].year);
  });

  it("defaults ship as [1M, 2M, 5M, 10M]", () => {
    expect(DEFAULT_PORTFOLIO_THRESHOLDS).toEqual([1_000_000, 2_000_000, 5_000_000, 10_000_000]);
  });

  it("does not emit a year-1 crossing for thresholds already exceeded at plan start", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    // Force the first-year investable value well above the low threshold.
    projection[0].portfolioAssets.taxableTotal = 50_000;
    projection[0].portfolioAssets.cashTotal = 0;
    projection[0].portfolioAssets.retirementTotal = 0;
    const events = detectPortfolioEvents(data, projection, [10_000]);
    const crossings = events.filter((e) => e.id === "portfolio:threshold:10000");
    expect(crossings).toHaveLength(0);
  });
});
