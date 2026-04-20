import { describe, it, expect } from "vitest";
import { arithToLogParams, rateFromLogReturn } from "../lognormal";

/**
 * Golden values from the eMoney Monte Carlo Methodology whitepaper (2020), p.8
 * "Calculating the Monte Carlo — Initial Setup — 2. Convert from Lognormal
 * Returns to Normal for Ease of Calculations". Each row is (arithMean, stdDev)
 * → (variance, meanSquared, lnVariance, mu, sigma).
 *
 *   lnvar = ln(1 + v / m²)         where v = SD², m² = (1 + arith)²
 *   μ     = ½ · ln(m⁴ / (m² + v))
 *   σ     = √lnvar
 */
const GOLDEN = [
  { arith: 0.1189, sd: 0.1527, v: 0.02332, m2: 1.25194, lnvar: 0.01845, mu: 0.10312, sigma: 0.13584 },
  { arith: 0.1043, sd: 0.1672, v: 0.02796, m2: 1.21948, lnvar: 0.02267, mu: 0.08788, sigma: 0.15055 },
  { arith: 0.0975, sd: 0.1501, v: 0.02253, m2: 1.20451, lnvar: 0.01853, mu: 0.08377, sigma: 0.13613 },
];

describe("arithToLogParams — eMoney whitepaper golden values", () => {
  for (const g of GOLDEN) {
    it(`arith=${g.arith}, sd=${g.sd} → lnvar=${g.lnvar}, μ=${g.mu}, σ=${g.sigma}`, () => {
      const out = arithToLogParams(g.arith, g.sd);
      // Doc rounds to 5 decimal places; match that precision.
      expect(out.variance).toBeCloseTo(g.v, 5);
      expect(out.meanSquared).toBeCloseTo(g.m2, 5);
      expect(out.lnVariance).toBeCloseTo(g.lnvar, 5);
      expect(out.mu).toBeCloseTo(g.mu, 5);
      expect(out.sigma).toBeCloseTo(g.sigma, 5);
    });
  }
});

describe("arithToLogParams — edge cases", () => {
  it("σ = 0 when stdDev = 0 (deterministic asset)", () => {
    const out = arithToLogParams(0.05, 0);
    expect(out.sigma).toBe(0);
    expect(out.lnVariance).toBe(0);
    // μ = ln(1 + arith) when SD = 0
    expect(out.mu).toBeCloseTo(Math.log(1.05), 10);
  });

  it("σ = √lnvar (identity), always", () => {
    const out = arithToLogParams(0.08, 0.2);
    expect(out.sigma).toBeCloseTo(Math.sqrt(out.lnVariance), 12);
  });
});

describe("rateFromLogReturn", () => {
  it("inverts lognormal: exp(y) - 1", () => {
    // From the eMoney p.11 worked example: y = [0.12274, 0.09592, 0.11192]
    // → r = [0.13059, 0.10067, 0.11843]. The PDF's final rates round to 5 dp
    // but its y values are themselves 5-dp rounded, so re-evaluating exp(y)-1
    // at the printed y disagrees with the printed r in the 5th decimal
    // (e.g. exp(0.11192)-1 = 0.11842, not 0.11843). Match to 4 dp; end-to-end
    // precision is exercised by the Phase 2 integration test that runs
    // unrounded values through the whole chain.
    expect(rateFromLogReturn(0.12274)).toBeCloseTo(0.13059, 4);
    expect(rateFromLogReturn(0.09592)).toBeCloseTo(0.10067, 4);
    expect(rateFromLogReturn(0.11192)).toBeCloseTo(0.11843, 4);
  });

  it("y = 0 → r = 0", () => {
    expect(rateFromLogReturn(0)).toBe(0);
  });
});
