import { describe, it, expect } from "vitest";
import { rollBenefitBase, payoutPercentForAge, resolvePayoutPercent } from "../benefit-base";
import type { AnnuityContract } from "../types";

const base = (over: Partial<AnnuityContract> = {}): AnnuityContract => ({
  productType: "fixed_indexed",
  taxTreatment: "non_qualified",
  annualFeePct: 0,
  incomeMode: "rider",
  rollupRatchets: true,
  benefitBase: 100_000,
  rollupRate: 0.06,
  ...over,
});

describe("rollBenefitBase", () => {
  it("compounds at the rollup rate while income is off", () => {
    const r = rollBenefitBase({
      contract: base(), currentBase: 100_000, accountValue: 95_000, year: 2030, incomeActive: false,
    });
    expect(r).toBeCloseTo(106_000, 2);
  });

  it("ratchets to the account value when the market beats the rollup", () => {
    const r = rollBenefitBase({
      contract: base(), currentBase: 100_000, accountValue: 120_000, year: 2030, incomeActive: false,
    });
    expect(r).toBeCloseTo(120_000, 2);
  });

  it("never decreases in a down market — the base is a floor, not a mirror", () => {
    const r = rollBenefitBase({
      contract: base({ rollupRate: 0 }), currentBase: 100_000, accountValue: 40_000, year: 2030, incomeActive: false,
    });
    expect(r).toBe(100_000);
  });

  it("does not ratchet when rollupRatchets is false", () => {
    const r = rollBenefitBase({
      contract: base({ rollupRatchets: false }), currentBase: 100_000, accountValue: 200_000, year: 2030, incomeActive: false,
    });
    expect(r).toBeCloseTo(106_000, 2);
  });

  it("stops rolling up after rollupEndYear", () => {
    const r = rollBenefitBase({
      contract: base({ rollupEndYear: 2029 }), currentBase: 100_000, accountValue: 50_000, year: 2030, incomeActive: false,
    });
    expect(r).toBe(100_000);
  });

  it("stops rolling up once income is active", () => {
    const r = rollBenefitBase({
      contract: base(), currentBase: 100_000, accountValue: 500_000, year: 2030, incomeActive: true,
    });
    expect(r).toBe(100_000);
  });

  it("throws on a rollup rate outside [0,1] — a 6 meaning \"6%\" would compound the base 7x a year", () => {
    expect(() => rollBenefitBase({
      contract: base({ rollupRate: 6 }), currentBase: 100_000, accountValue: 95_000, year: 2030, incomeActive: false,
    })).toThrow("rollupRate out of [0,1]: 6");
  });

  it("throws on a NaN rollup rate rather than poisoning every later year", () => {
    expect(() => rollBenefitBase({
      contract: base({ rollupRate: Number.NaN }), currentBase: 100_000, accountValue: 95_000, year: 2030, incomeActive: false,
    })).toThrow("rollupRate out of [0,1]: NaN");
  });

  it("accepts the boundary rates 0 and 1", () => {
    const roll = (rollupRate: number) => rollBenefitBase({
      contract: base({ rollupRate }), currentBase: 100_000, accountValue: 0, year: 2030, incomeActive: false,
    });
    expect(roll(0)).toBe(100_000);
    expect(roll(1)).toBe(200_000);
  });
});

describe("payoutPercentForAge", () => {
  it("increases with age across the bands", () => {
    expect(payoutPercentForAge(57)).toBeLessThan(payoutPercentForAge(67));
    expect(payoutPercentForAge(67)).toBeLessThan(payoutPercentForAge(82));
  });

  it("returns 5% at 65 and 6.5% at 80+", () => {
    expect(payoutPercentForAge(65)).toBeCloseTo(0.05, 4);
    expect(payoutPercentForAge(85)).toBeCloseTo(0.065, 4);
  });

  it("floors below the youngest band rather than returning zero", () => {
    expect(payoutPercentForAge(40)).toBeGreaterThan(0);
  });
});

describe("resolvePayoutPercent", () => {
  it("prefers the contract's explicit percent over the band table", () => {
    expect(resolvePayoutPercent(base({ payoutPct: 0.072 }), 65)).toBeCloseTo(0.072, 4);
  });

  it("falls back to the band table when the contract has none", () => {
    expect(resolvePayoutPercent(base(), 65)).toBeCloseTo(0.05, 4);
  });

  it("throws on a payout percent outside [0,1] — a 5 meaning \"5%\" would guarantee 500% of the base for life", () => {
    expect(() => resolvePayoutPercent(base({ payoutPct: 5 }), 65)).toThrow("payoutPct out of [0,1]: 5");
  });

  it("accepts the boundary percents 0 and 1", () => {
    expect(resolvePayoutPercent(base({ payoutPct: 0 }), 65)).toBe(0);
    expect(resolvePayoutPercent(base({ payoutPct: 1 }), 65)).toBe(1);
  });

  it("treats an explicit 0 as a real choice, not a missing value — no band-table fallback", () => {
    expect(resolvePayoutPercent(base({ payoutPct: 0 }), 65)).toBe(0);
    expect(payoutPercentForAge(65)).toBeCloseTo(0.05, 4);
  });
});
