import { describe, it, expect } from "vitest";
import { installmentSaleSplit } from "../tax-split";

describe("installmentSaleSplit", () => {
  it("returns all basis recovery when basis equals face value (cash loan)", () => {
    expect(installmentSaleSplit(100_000, 100_000, 10_000)).toEqual({
      ltcg: 0,
      basisRecovery: 10_000,
    });
  });

  it("returns all LTCG when basis is zero", () => {
    expect(installmentSaleSplit(100_000, 0, 10_000)).toEqual({
      ltcg: 10_000,
      basisRecovery: 0,
    });
  });

  it("splits pro-rata when basis is less than face value", () => {
    // gainShare = (100 - 40) / 100 = 0.6
    expect(installmentSaleSplit(100_000, 40_000, 10_000)).toEqual({
      ltcg: 6_000,
      basisRecovery: 4_000,
    });
  });

  it("clamps gain share to zero when basis exceeds face value (loss case)", () => {
    expect(installmentSaleSplit(100_000, 120_000, 10_000)).toEqual({
      ltcg: 0,
      basisRecovery: 10_000,
    });
  });

  it("uses a constant gross-profit ratio across the life of the note (cumulative invariant)", () => {
    const faceValue = 100_000;
    const basis = 40_000;
    const principalPayments = [10_000, 15_000, 25_000, 30_000, 20_000]; // sums to 100_000
    let totalLtcg = 0;
    let totalBasis = 0;
    for (const p of principalPayments) {
      const { ltcg, basisRecovery } = installmentSaleSplit(faceValue, basis, p);
      totalLtcg += ltcg;
      totalBasis += basisRecovery;
    }
    expect(totalLtcg).toBeCloseTo(faceValue - basis, 6);
    expect(totalBasis).toBeCloseTo(basis, 6);
  });

  it("returns all basis recovery when face value is zero (defensive)", () => {
    expect(installmentSaleSplit(0, 0, 1_000)).toEqual({
      ltcg: 0,
      basisRecovery: 1_000,
    });
  });
});
