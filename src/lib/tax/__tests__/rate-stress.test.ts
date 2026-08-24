import { describe, it, expect } from "vitest";
import { applyTaxRateStress, withStatutoryRates, MAX_RATE_STRESS_POINTS } from "../rate-stress";
import { rateStressParams } from "./fixtures";
import type { TaxYearParameters } from "../types";

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
    // EVERYTHING except the four keys the transform may write — not a hand-
    // picked list. The earlier version named 6 of the ~19 top-level fields, so
    // a widening that reached for any of the other 13 (niitThreshold, qbi,
    // saversCredit, the state tables…) would have sailed through.
    const MAY_CHANGE = [
      "incomeBrackets", "capGainsBrackets",
      "trustIncomeBrackets", "trustCapGainsBrackets",
    ];
    const outsideScope = (p: TaxYearParameters) =>
      Object.fromEntries(Object.entries(p).filter(([k]) => !MAY_CHANGE.includes(k)));
    expect(outsideScope(out)).toEqual(outsideScope(before));
    // Vacuity guard: the compare above is worthless if it comes back empty.
    expect(Object.keys(outsideScope(out)).length).toBeGreaterThan(10);
  });

  it("leaves a zero rate at zero on ORDINARY and preferential schedules alike", () => {
    // `bump()` is shared by both schedules, but only the preferential ones
    // carry a real 0% band, so the ordinary half of that rule was inferred
    // rather than tested. A synthetic 0% ordinary tier makes it explicit.
    const params = rateStressParams();
    params.incomeBrackets.single = [
      { from: 0, to: 1_000, rate: 0 },
      { from: 1_000, to: null, rate: 0.10 },
    ];
    const out = applyTaxRateStress(params, STRESS, 2030);
    expect(out.incomeBrackets.single[0].rate).toBe(0);
    expect(out.incomeBrackets.single[1].rate).toBeCloseTo(0.13, 10);  // guards the above
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
    // toBe, not toEqual: the contract is the EARLY RETURN — the same object
    // back, no allocation. A rebuilt copy is toEqual-identical and would slip
    // straight past a structural comparison.
    expect(withStatutoryRates(plain)).toBe(plain);
  });
});

describe("applyTaxRateStress — payloads that never passed zod", () => {
  // The solver's schema rejects these, but `applyChanges` writes a stored
  // scenario value straight onto planSettings without re-validating, so the
  // transform is the last line of defence.
  it("ignores a stressor whose startYear is not a finite number", () => {
    // `year < undefined` is false, so without the guard this stresses EVERY
    // year — including years in the past.
    for (const startYear of [undefined, Number.NaN] as unknown as number[]) {
      const out = applyTaxRateStress(rateStressParams(), { points: 0.03, startYear }, 2030);
      expect(out).toEqual(rateStressParams());
    }
  });

  it("ignores a non-numeric points value", () => {
    const out = applyTaxRateStress(rateStressParams(), { points: Number.NaN, startYear: 2030 }, 2030);
    // Without effectivePoints' Number.isFinite check every rate becomes NaN.
    expect(out).toEqual(rateStressParams());
  });
});
