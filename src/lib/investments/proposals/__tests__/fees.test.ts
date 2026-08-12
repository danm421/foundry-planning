import { describe, it, expect } from "vitest";
import { blendExpenseRatio, buildFeeComparison } from "../fees";

describe("blendExpenseRatio", () => {
  it("weights by market value", () => {
    const { blended, coveragePct } = blendExpenseRatio([
      { marketValue: 75_000, expenseRatio: 0.0004 },
      { marketValue: 25_000, expenseRatio: 0.0020 },
    ]);
    expect(blended).toBeCloseTo(0.0008, 10);
    expect(coveragePct).toBe(1);
  });

  it("excludes unknowns from the mean instead of treating them as zero", () => {
    const { blended, coveragePct } = blendExpenseRatio([
      { marketValue: 50_000, expenseRatio: 0.0010 },
      { marketValue: 50_000, expenseRatio: null },
    ]);
    // The known half averages to 0.10%. Zero-filling the unknown half would
    // wrongly report 0.05% and invent a saving that does not exist.
    expect(blended).toBeCloseTo(0.001, 10);
    expect(coveragePct).toBeCloseTo(0.5, 10);
  });

  it("reports null with zero coverage when nothing is known", () => {
    expect(blendExpenseRatio([{ marketValue: 10_000, expenseRatio: null }])).toEqual({
      blended: null,
      coveragePct: 0,
    });
  });

  it("handles an empty portfolio", () => {
    expect(blendExpenseRatio([])).toEqual({ blended: null, coveragePct: 0 });
  });
});

describe("buildFeeComparison", () => {
  const base = {
    totalValue: 1_000_000,
    currentHoldings: [{ marketValue: 1_000_000, expenseRatio: 0.0080 }],
    proposedHoldings: [{ marketValue: 1_000_000, expenseRatio: 0.0015 }],
    advisoryFeeCurrent: null,
    advisoryFeeProposed: null,
  };

  it("dollarizes both sides and reports the saving as a positive number", () => {
    const r = buildFeeComparison(base);
    expect(r.annualDollarsCurrent).toBeCloseTo(8_000, 6);
    expect(r.annualDollarsProposed).toBeCloseTo(1_500, 6);
    expect(r.annualDollarsSaved).toBeCloseTo(6_500, 6);
  });

  it("adds the advisory fee on top of the fund cost without conflating them", () => {
    const r = buildFeeComparison({
      ...base,
      advisoryFeeCurrent: 0.01,
      advisoryFeeProposed: 0.0075,
    });
    expect(r.currentBlendedEr).toBeCloseTo(0.008, 10);
    expect(r.advisoryFeeCurrent).toBeCloseTo(0.01, 10);
    expect(r.annualDollarsCurrent).toBeCloseTo(18_000, 6);
    expect(r.annualDollarsProposed).toBeCloseTo(9_000, 6);
  });

  it("suppresses the blend when coverage falls below the floor", () => {
    const r = buildFeeComparison({
      ...base,
      currentHoldings: [
        { marketValue: 400_000, expenseRatio: 0.0080 },
        { marketValue: 600_000, expenseRatio: null },
      ],
    });
    expect(r.currentCoveragePct).toBeCloseTo(0.4, 10);
    expect(r.currentBlendedEr).toBeNull();
    expect(r.annualDollarsCurrent).toBeNull();
    expect(r.annualDollarsSaved).toBeNull();
  });

  it("keeps the blend when coverage is merely low but above the floor", () => {
    const r = buildFeeComparison({
      ...base,
      currentHoldings: [
        { marketValue: 700_000, expenseRatio: 0.0080 },
        { marketValue: 300_000, expenseRatio: null },
      ],
    });
    expect(r.currentCoveragePct).toBeCloseTo(0.7, 10);
    expect(r.currentBlendedEr).toBeCloseTo(0.008, 10);
  });
});
