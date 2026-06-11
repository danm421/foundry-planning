import { describe, it, expect } from "vitest";
import type { MonthlyReturn } from "./cma-stats";
import { computePortfolioPanel, computeLookThrough } from "./ticker-portfolio-service";

const mr = (pairs: [string, number][]): MonthlyReturn[] =>
  pairs.map(([date, r]) => ({ date, r }));

describe("computePortfolioPanel", () => {
  it("blends, computes the window, and names the limiting ticker", () => {
    const holdings = [
      { ticker: "AAA", weight: 0.5, returns: mr([["2020-01", 0.01], ["2020-02", 0.02], ["2020-03", 0.03]]) },
      { ticker: "BBB", weight: 0.5, returns: mr([["2020-02", 0.00], ["2020-03", 0.01]]) }, // starts later
    ];
    const panel = computePortfolioPanel(holdings, 0.04);
    expect(panel.windowStart).toBe("2020-02");
    expect(panel.windowEnd).toBe("2020-03");
    expect(panel.nMonths).toBe(2);
    expect(panel.limitingTicker).toBe("BBB");
    expect(panel.stats.sharpe).toBeCloseTo(
      (panel.stats.annArithMean - 0.04) / panel.stats.annVolatility,
      10,
    );
  });

  it("flags too-short history (< MIN_MONTHS) via insufficientHistory", () => {
    const holdings = [{ ticker: "AAA", weight: 1, returns: mr([["2020-01", 0.01], ["2020-02", 0.02]]) }];
    const panel = computePortfolioPanel(holdings, 0.04);
    expect(panel.insufficientHistory).toBe(true); // nMonths < 36
  });
});

describe("computeLookThrough", () => {
  it("blends slug allocation and tax composition by portfolio weight", () => {
    const holdings = [
      { ticker: "AAA", weight: 0.5, slugWeights: [{ slug: "us_large_cap", weight: 1.0 }] },
      { ticker: "BBB", weight: 0.5, slugWeights: [{ slug: "ten_year_treasury", weight: 1.0 }] },
    ];
    const taxBySlug = {
      us_large_cap: { pctOrdinaryIncome: 0, pctLtCapitalGains: 0.8, pctQualifiedDividends: 0.2, pctTaxExempt: 0 },
      ten_year_treasury: { pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
    };
    const lt = computeLookThrough(holdings, taxBySlug);
    expect(lt.allocation.find((a) => a.slug === "us_large_cap")!.weight).toBeCloseTo(0.5, 10);
    expect(lt.allocation.find((a) => a.slug === "ten_year_treasury")!.weight).toBeCloseTo(0.5, 10);
    expect(lt.tax.pctOrdinaryIncome).toBeCloseTo(0.5, 10); // 0.5*0 + 0.5*1
    expect(lt.tax.pctLtCapitalGains).toBeCloseTo(0.4, 10); // 0.5*0.8
  });
});
