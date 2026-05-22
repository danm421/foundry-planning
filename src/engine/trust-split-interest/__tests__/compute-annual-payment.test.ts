import { describe, it, expect } from "vitest";
import {
  computeAnnualAnnuityPayment,
  computeAnnualUnitrustPayment,
} from "../compute-annual-payment";
import { runProjection } from "@/engine/projection";
import {
  buildCltLifecycleFixture,
  CLT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/clt";

describe("computeAnnualUnitrustPayment", () => {
  it("returns payoutPercent × startOfYearFmv", () => {
    const result = computeAnnualUnitrustPayment({
      payoutPercent: 0.06,
      startOfYearFmv: 1_000_000,
    });
    expect(result.unitrustAmount).toBeCloseTo(60_000, 2);
  });

  it("returns 0 when startOfYearFmv is 0 (trust depleted)", () => {
    const result = computeAnnualUnitrustPayment({
      payoutPercent: 0.06,
      startOfYearFmv: 0,
    });
    expect(result.unitrustAmount).toBe(0);
  });

  it("rejects payoutPercent > 1", () => {
    expect(() =>
      computeAnnualUnitrustPayment({
        payoutPercent: 1.5,
        startOfYearFmv: 1_000_000,
      }),
    ).toThrow();
  });

  it("rejects negative payoutPercent", () => {
    expect(() =>
      computeAnnualUnitrustPayment({
        payoutPercent: -0.01,
        startOfYearFmv: 1_000_000,
      }),
    ).toThrow();
  });
});

describe("computeAnnualAnnuityPayment", () => {
  it("returns payoutAmount as-is", () => {
    expect(computeAnnualAnnuityPayment({ payoutAmount: 60_000 })).toEqual({
      annuityAmount: 60_000,
    });
  });

  it("rejects negative payoutAmount", () => {
    expect(() =>
      computeAnnualAnnuityPayment({ payoutAmount: -1 }),
    ).toThrow(/payoutAmount/);
  });

  it("returns 0 for payoutAmount=0", () => {
    expect(computeAnnualAnnuityPayment({ payoutAmount: 0 })).toEqual({
      annuityAmount: 0,
    });
  });
});

describe("CLT annual payment integration in projection", () => {
  it("emits a charitable outflow each year of the term, none after", () => {
    const data = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
    });
    const years = runProjection(data);

    for (let yr = 2026; yr <= 2030; yr++) {
      const y = years.find((r) => r.year === yr)!;
      expect(y.charitableOutflows ?? 0).toBeGreaterThan(0);
    }
    const post = years.find((y) => y.year === 2031)!;
    expect(post.charitableOutflows ?? 0).toBe(0);
  });

  it("drains the CLT-owned account by ~payoutPercent each year of the term", () => {
    const data = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 5_000_000,
    });
    const years = runProjection(data);
    const inception = years.find((y) => y.year === 2026)!;
    const ledger = inception.accountLedgers[CLT_FIXTURE_IDS.CLT_CHECKING_ID];
    expect(ledger).toBeDefined();
    // After year 1 the CLT account should be ~$940K (1M - 6% × 1M).
    expect(ledger.endingValue).toBeLessThan(1_000_000);
    expect(ledger.endingValue).toBeCloseTo(940_000, -3);
  });
});
