import { describe, it, expect } from "vitest";
import { applyTaxRateStress, withStatutoryRates, MAX_RATE_STRESS_POINTS } from "../rate-stress";
import { rateStressParams } from "./fixtures";

const STRESS = { points: 0.03, startYear: 2030 };

describe("applyTaxRateStress", () => {
  it("is a no-op before the start year", () => {
    const out = applyTaxRateStress(rateStressParams(), STRESS, 2029);
    expect(out.incomeBrackets.married_joint[0].rate).toBe(0.10);
    expect(out).toEqual(rateStressParams());
  });

  it("is a no-op when no stress is configured", () => {
    expect(applyTaxRateStress(rateStressParams(), undefined, 2030)).toEqual(rateStressParams());
  });

  it("is a no-op when points is zero", () => {
    expect(applyTaxRateStress(rateStressParams(), { points: 0, startYear: 2030 }, 2030)).toEqual(rateStressParams());
  });

  it("adds points to every ordinary rate from the start year", () => {
    const out = applyTaxRateStress(rateStressParams(), STRESS, 2030);
    // Per-element toBeCloseTo, NOT toEqual on the array: 0.10 + 0.03 is
    // 0.13000000000000003 in IEEE-754, and toEqual compares numbers exactly.
    const mfj = out.incomeBrackets.married_joint.map((t) => t.rate);
    expect(mfj[0]).toBeCloseTo(0.13, 10);
    expect(mfj[1]).toBeCloseTo(0.15, 10);
    expect(mfj[2]).toBeCloseTo(0.40, 10);
    expect(out.incomeBrackets.single[0].rate).toBeCloseTo(0.13, 10);
    expect(out.incomeBrackets.head_of_household[0].rate).toBeCloseTo(0.13, 10);
    expect(out.incomeBrackets.married_separate[0].rate).toBeCloseTo(0.13, 10);
  });

  it("leaves every bracket threshold untouched", () => {
    const out = applyTaxRateStress(rateStressParams(), STRESS, 2030);
    expect(out.incomeBrackets.married_joint.map((t) => [t.from, t.to]))
      .toEqual([[0, 24800], [24800, 100800], [100800, null]]);
    // Load-bearing: projection.ts:2818 derives the trust NIIT threshold from
    // trustIncomeBrackets[3].from. Rates-only is what keeps that honest.
    expect(out.trustIncomeBrackets.map((t) => t.from)).toEqual([0, 3300, 12000, 16300]);
  });

  it("raises trust ordinary and preferential rates", () => {
    const out = applyTaxRateStress(rateStressParams(), STRESS, 2030);
    const ord = out.trustIncomeBrackets.map((t) => t.rate);
    expect(ord[0]).toBeCloseTo(0.13, 10);
    expect(ord[1]).toBeCloseTo(0.27, 10);
    expect(ord[2]).toBeCloseTo(0.38, 10);
    expect(ord[3]).toBeCloseTo(0.40, 10);
    const pref = out.trustCapGainsBrackets.map((t) => t.rate);
    expect(pref[0]).toBe(0);            // exact — the zero rule, not arithmetic
    expect(pref[1]).toBeCloseTo(0.18, 10);
    expect(pref[2]).toBeCloseTo(0.23, 10);
  });

  it("leaves every parameter outside its scope untouched", () => {
    const out = applyTaxRateStress(rateStressParams(), STRESS, 2030);
    const before = rateStressParams();
    // The spec freezes these by decision. The transform spreads `...params` and
    // overrides only four fields, so this holds by construction — the test is
    // here so a later "while we're in here" widening has to argue with it.
    expect(out.niitRate).toBe(before.niitRate);
    expect(out.stdDeduction).toEqual(before.stdDeduction);
    expect(out.amtExemption).toEqual(before.amtExemption);
    expect(out.amtBreakpoint2628).toEqual(before.amtBreakpoint2628);
    expect(out.ssTaxRate).toBe(before.ssTaxRate);
    expect(out.contribLimits).toEqual(before.contribLimits);
  });

  it("leaves a zero rate at zero", () => {
    const out = applyTaxRateStress(rateStressParams(), STRESS, 2030);
    expect(out.trustCapGainsBrackets[0].rate).toBe(0);
  });

  it("writes the personal preferential rates onto the cap-gains tiers", () => {
    const out = applyTaxRateStress(rateStressParams(), STRESS, 2030);
    expect(out.capGainsBrackets.married_joint.midRate).toBeCloseTo(0.18, 10);
    expect(out.capGainsBrackets.married_joint.topRate).toBeCloseTo(0.23, 10);
    // Thresholds still untouched.
    expect(out.capGainsBrackets.married_joint.zeroPctTop).toBe(99200);
    expect(out.capGainsBrackets.single.midRate).toBeCloseTo(0.18, 10);
  });

  it("clamps points to the maximum", () => {
    const out = applyTaxRateStress(rateStressParams(), { points: 5, startYear: 2030 }, 2030);
    expect(out.incomeBrackets.married_joint[0].rate)
      .toBeCloseTo(0.10 + MAX_RATE_STRESS_POINTS, 10);
  });

  it("ignores a negative points value", () => {
    const out = applyTaxRateStress(rateStressParams(), { points: -0.05, startYear: 2030 }, 2030);
    expect(out).toEqual(rateStressParams());
  });

  it("does not mutate its input", () => {
    const input = rateStressParams();
    const snapshot = structuredClone(input);
    applyTaxRateStress(input, STRESS, 2030);
    expect(input).toEqual(snapshot);
  });
});

describe("withStatutoryRates", () => {
  it("strips stressed rates back to statutory", () => {
    const stressed = { zeroPctTop: 99200, fifteenPctTop: 615900, midRate: 0.18, topRate: 0.23 };
    expect(withStatutoryRates(stressed)).toEqual({ zeroPctTop: 99200, fifteenPctTop: 615900 });
  });

  it("passes an unstressed tier through unchanged", () => {
    const plain = { zeroPctTop: 99200, fifteenPctTop: 615900 };
    expect(withStatutoryRates(plain)).toEqual(plain);
  });
});
