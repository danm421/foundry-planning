import { describe, it, expect } from "vitest";
import { buildProposalSnapshot } from "../snapshot";
import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";
import fixture from "./fixtures/snapshot-v1.json";
import type { ProposalSnapshot } from "../types";

const compute: RebalanceComputeResult = {
  current: {
    totalValue: 1_000_000,
    assetMix: [{ assetClassId: "a", name: "US Large Cap", weight: 1 }],
    realized: null,
    cma: { arithmeticMean: 0.065, geometricReturn: 0.058, stdDev: 0.14, sharpe: 0.3 },
    coveragePct: 1,
  },
  proposed: {
    totalValue: 1_000_000,
    assetMix: [{ assetClassId: "a", name: "US Large Cap", weight: 1 }],
    realized: null,
    cma: { arithmeticMean: 0.07, geometricReturn: 0.064, stdDev: 0.115, sharpe: 0.42 },
    coveragePct: 1,
  },
  assetMixDelta: [],
  tradeSummary: [],
  tax: {
    taxableMarketValue: 500_000,
    taxableCostBasis: 400_000,
    realizedGain: 100_000,
    effectiveRate: 0.18,
    rateSource: "engine",
    estimatedTax: 18_000,
    notes: [],
  },
  realizedWindow: {
    windowStart: null,
    windowEnd: null,
    nMonths: 0,
    insufficientHistory: true,
    shortHistory: false,
  },
  sourceUnresolvedTickers: [],
};

const baseInput = {
  compute,
  computedAt: "2026-08-12T00:00:00.000Z",
  currentFeeHoldings: [{ marketValue: 1_000_000, expenseRatio: 0.008 }],
  proposedFeeHoldings: [{ marketValue: 1_000_000, expenseRatio: 0.0015 }],
  advisoryFeeCurrent: null,
  advisoryFeeProposed: null,
  aligned: { a: [], b: [], windowStart: null, windowEnd: null, nMonths: 0 },
  profile: null,
  currentLevel: null,
  proposedLevel: "moderate" as const,
  rungs: [],
  targetHoldings: [{ ticker: "VTI", name: "Vanguard Total Stock", weight: 1, expenseRatio: 0.0003 }],
};

describe("buildProposalSnapshot", () => {
  it("stamps the version and the computed-at date", () => {
    const s = buildProposalSnapshot(baseInput);
    expect(s.version).toBe(1);
    expect(s.computedAt).toBe("2026-08-12T00:00:00.000Z");
  });

  it("feeds the fee saving into the break-even", () => {
    const s = buildProposalSnapshot(baseInput);
    // return delta 0.6% + fee saving 0.65% = 1.25% of $1M = $12,500/yr
    // against $18,000 of tax.
    expect(s.breakEven.annualBenefit).toBeCloseTo(12_500, 4);
    expect(s.breakEven.years).toBeCloseTo(18_000 / 12_500, 6);
  });

  it("returns a null backtest when there is no shared history", () => {
    expect(buildProposalSnapshot(baseInput).backtest).toBeNull();
  });

  it("still reports three stress windows, all unavailable", () => {
    const s = buildProposalSnapshot(baseInput);
    expect(s.stress).toHaveLength(3);
    expect(s.stress.every((w) => !w.available)).toBe(true);
  });

  it("builds the cone off each side's own assumptions", () => {
    const s = buildProposalSnapshot(baseInput);
    expect(s.outcomes.proposed[0].p50).toBeGreaterThan(s.outcomes.current[0].p50);
  });
});

describe("ProposalSnapshot v1 durability", () => {
  it("still type-checks and reads after the builders change", () => {
    // A proposal presented to a client months ago must still render. This test
    // fails the moment a field is renamed or removed without a migration, which
    // is exactly when someone is about to break a document a client is holding.
    const s = fixture as unknown as ProposalSnapshot;
    expect(s.version).toBe(1);
    expect(s.compute.current.totalValue).toBeGreaterThan(0);
    expect(s.fees).toHaveProperty("annualDollarsSaved");
    expect(s.suitability).toHaveProperty("currentExceedsProfile");
    expect(s.breakEven).toHaveProperty("verdict");
    expect(Array.isArray(s.stress)).toBe(true);
    expect(s.outcomes.current.length).toBeGreaterThan(0);
  });
});
