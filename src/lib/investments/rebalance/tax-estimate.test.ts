import { describe, it, expect } from "vitest";
import {
  estimateRealizedGain,
  deriveEffectiveLtcgRate,
  estimateRebalanceTax,
} from "./tax-estimate";

describe("estimateRealizedGain", () => {
  it("sums market value minus cost basis across taxable holdings", () => {
    const out = estimateRealizedGain([
      { marketValue: 10000, costBasis: 6000 },
      { marketValue: 5000, costBasis: 5500 },
    ]);
    expect(out.marketValue).toBe(15000);
    expect(out.costBasis).toBe(11500);
    expect(out.gain).toBe(3500);
  });
});

describe("deriveEffectiveLtcgRate", () => {
  // ordinaryBase well above the 15% threshold → the next gain dollars are all 15%,
  // plus 3.8% NIIT because MAGI is over the threshold.
  it("blends the federal marginal bracket with NIIT", () => {
    const rate = deriveEffectiveLtcgRate({
      ordinaryBase: 300000,
      existingLtcg: 0,
      brackets: { zeroPctTop: 94050, fifteenPctTop: 583750 },
      niit: { magi: 300000, investmentIncome: 0, threshold: 250000, rate: 0.038 },
      incrementalGain: 100000,
    });
    expect(rate).toBeCloseTo(0.15 + 0.038, 4); // 0.188
  });

  it("returns 0 for a non-positive gain", () => {
    expect(
      deriveEffectiveLtcgRate({
        ordinaryBase: 0,
        existingLtcg: 0,
        brackets: { zeroPctTop: 94050, fifteenPctTop: 583750 },
        niit: { magi: 0, investmentIncome: 0, threshold: 250000, rate: 0.038 },
        incrementalGain: 0,
      }),
    ).toBe(0);
  });
});

describe("estimateRebalanceTax", () => {
  it("multiplies a positive gain by the rate", () => {
    const out = estimateRebalanceTax({ gain: 3500, rate: 0.2, rateSource: "override" });
    expect(out.estimatedTax).toBeCloseTo(700, 6);
    expect(out.rateSource).toBe("override");
  });

  it("never taxes a net loss and notes it", () => {
    const out = estimateRebalanceTax({ gain: -1000, rate: 0.2, rateSource: "engine" });
    expect(out.estimatedTax).toBe(0);
    expect(out.notes.some((n) => /loss/i.test(n))).toBe(true);
  });
});
