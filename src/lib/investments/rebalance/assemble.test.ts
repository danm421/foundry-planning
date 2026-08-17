import { describe, it, expect } from "vitest";
import { assembleRebalanceResult, type RebalanceInputs } from "./assemble";
import { REALIZED_COVERAGE_MIN } from "./panel-from-holdings";
import type { MonthlyReturn } from "@/lib/cma-stats";

const series = (vals: number[]): MonthlyReturn[] =>
  vals.map((v, i) => ({ date: `2020-${String((i % 12) + 1).padStart(2, "0")}`, r: v }));

// 40 months so the common window clears MIN_MONTHS (36).
const longSeries = (base: number): MonthlyReturn[] =>
  Array.from({ length: 40 }, (_, i) => ({
    date: `20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
    r: base,
  }));

function baseInputs(): RebalanceInputs {
  return {
    riskFreeRate: 0.04,
    assetClasses: [
      { id: "us", name: "US Large Cap", slug: "us_large_cap", geometricReturn: 0.1, arithmeticMean: 0.11, volatility: 0.15, pctOrdinaryIncome: 0, pctLtCapitalGains: 1, pctQualifiedDividends: 0, pctTaxExempt: 0 },
      { id: "bond", name: "Bonds", slug: "ten_year_treasury", geometricReturn: 0.03, arithmeticMean: 0.032, volatility: 0.05, pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
    ],
    correlationRows: [],
    currentHoldings: [
      { id: "h1", securityId: "spy", ticker: "SPY", shares: 100, price: 100, marketValue: 10000, costBasis: 6000, isTaxable: true, securityWeights: [{ slug: "us_large_cap", weight: 1 }], overrides: [] },
    ],
    currentReturnsBySecurity: new Map([["spy", longSeries(0.01)]]),
    targetHoldings: [
      { securityId: "agg", ticker: "AGG", weight: 1 },
    ],
    targetReturnsBySecurity: new Map([["agg", longSeries(0.002)]]),
    targetAllocations: [{ assetClassId: "bond", weight: 1 }],
    taxContext: {
      ordinaryBase: 100000, // above zeroPctTop (94050) so the 4000 gain falls in the 15% bracket
      existingLtcg: 0,
      brackets: { zeroPctTop: 94050, fifteenPctTop: 583750 },
      niit: { magi: 100000, investmentIncome: 0, threshold: 250000, rate: 0.038 },
    },
    overrideLtcgRate: undefined,
  };
}

describe("assembleRebalanceResult", () => {
  it("produces both sides, deltas, trades, and a tax estimate", () => {
    const out = assembleRebalanceResult(baseInputs());

    // current is 100% US, proposed is 100% bonds
    expect(out.current.assetMix[0].assetClassId).toBe("us");
    expect(out.proposed.assetMix[0].assetClassId).toBe("bond");

    // realized stats present (window ≥ 36 months)
    expect(out.realizedWindow.insufficientHistory).toBe(false);
    expect(out.current.realized).not.toBeNull();
    expect(out.proposed.realized).not.toBeNull();

    // trade: sell all US, buy all bonds on 10,000
    const sell = out.tradeSummary.find((t) => t.assetClassId === "us")!;
    expect(sell.action).toBe("sell");
    expect(sell.deltaValue).toBeCloseTo(-10000, 6);

    // tax: gain 4000, taxable, 15% bracket + 0 NIIT (under threshold)
    expect(out.tax.realizedGain).toBeCloseTo(4000, 6);
    expect(out.tax.estimatedTax).toBeCloseTo(600, 0);
    expect(out.tax.rateSource).toBe("engine");
  });

  it("uses the override rate and skips engine derivation", () => {
    const out = assembleRebalanceResult({ ...baseInputs(), overrideLtcgRate: 0.238 });
    expect(out.tax.rateSource).toBe("override");
    expect(out.tax.estimatedTax).toBeCloseTo(4000 * 0.238, 4);
  });

  it("suppresses realized stats when the common window is too short", () => {
    const inputs = baseInputs();
    inputs.currentReturnsBySecurity = new Map([["spy", series([0.01, 0.02])]]); // 2 months
    const out = assembleRebalanceResult(inputs);
    expect(out.realizedWindow.insufficientHistory).toBe(true);
    expect(out.current.realized).toBeNull();
    expect(out.proposed.realized).toBeNull();
  });
});

/**
 * Holdings with no price history are dropped from the realized series and the
 * survivors renormalized to 100%, so a thinly-covered side reports stats for a
 * portfolio nobody owns. These pin the guard that stops that reaching a client.
 */
describe("assembleRebalanceResult — realized coverage", () => {
  /** Adds an uncovered holding worth `value` to the current side. */
  const withUncoveredCurrent = (value: number): RebalanceInputs => {
    const inputs = baseInputs();
    inputs.currentHoldings = [
      ...inputs.currentHoldings,
      {
        id: "h2",
        securityId: "cash",
        ticker: "SPAXX",
        shares: value,
        price: 1,
        marketValue: value,
        costBasis: value,
        isTaxable: true,
        securityWeights: [{ slug: "us_large_cap", weight: 1 }],
        overrides: [],
      },
    ];
    return inputs; // "cash" has no entry in currentReturnsBySecurity
  };

  it("reports the excluded tickers on each side", () => {
    const out = assembleRebalanceResult(withUncoveredCurrent(1000));
    expect(out.current.uncoveredTickers).toEqual(["SPAXX"]);
    expect(out.proposed.uncoveredTickers).toEqual([]);
  });

  it("keeps realized stats when coverage clears the floor", () => {
    // 10,000 covered of 11,000 → 90.9%
    const out = assembleRebalanceResult(withUncoveredCurrent(1000));
    expect(out.current.coveragePct).toBeGreaterThan(REALIZED_COVERAGE_MIN);
    expect(out.realizedWindow.coverageSuppressed).toBe(false);
    expect(out.current.realized).not.toBeNull();
  });

  it("suppresses BOTH sides when the current side is under-covered", () => {
    // 10,000 covered of 40,000 → 25%, below the 50% floor
    const out = assembleRebalanceResult(withUncoveredCurrent(30000));
    expect(out.current.coveragePct).toBeLessThan(REALIZED_COVERAGE_MIN);
    expect(out.realizedWindow.coverageSuppressed).toBe(true);
    expect(out.current.realized).toBeNull();
    // The proposed side is fully covered, but a one-sided comparison is not a
    // comparison — withholding only the thin side would invite reading the
    // survivor as the answer.
    expect(out.proposed.realized).toBeNull();
  });

  it("suppresses when the PROPOSED side is under-covered", () => {
    // The case the UI could never surface: it only ever showed current coverage.
    const inputs = baseInputs();
    inputs.targetHoldings = [
      { securityId: "agg", ticker: "AGG", weight: 0.2 },
      { securityId: "vt", ticker: "VT", weight: 0.8 }, // no returns loaded
    ];
    const out = assembleRebalanceResult(inputs);
    expect(out.proposed.coveragePct).toBeCloseTo(0.2, 6);
    expect(out.proposed.uncoveredTickers).toEqual(["VT"]);
    expect(out.realizedWindow.coverageSuppressed).toBe(true);
    expect(out.current.realized).toBeNull();
    expect(out.proposed.realized).toBeNull();
  });

  it("leaves the forward-looking CMA stats untouched when coverage is suppressed", () => {
    // CMA reads asset-class weights, not price history — an uncovered holding
    // still carries its allocation, so those numbers stay valid and shown.
    const out = assembleRebalanceResult(withUncoveredCurrent(30000));
    expect(out.realizedWindow.coverageSuppressed).toBe(true);
    expect(out.current.cma.geometricReturn).toBeCloseTo(0.1, 6);
    expect(out.proposed.cma.geometricReturn).toBeCloseTo(0.03, 6);
  });
});
