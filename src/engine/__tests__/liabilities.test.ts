import { describe, it, expect } from "vitest";
import { computeLiabilities, amortizeLiability } from "../liabilities";
import { sampleLiabilities } from "./fixtures";

describe("amortizeLiability", () => {
  it("computes annual payment, interest, and principal split", () => {
    const result = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.annualPayment).toBe(30000);
    expect(result.interestPortion).toBeCloseTo(19500, 0);
    expect(result.principalPortion).toBeCloseTo(10500, 0);
    expect(result.endingBalance).toBeCloseTo(289500, 0);
  });

  it("returns zero for years outside liability range", () => {
    const result = amortizeLiability(sampleLiabilities[0], 2046);
    expect(result.annualPayment).toBe(0);
    expect(result.endingBalance).toBe(0);
  });

  it("caps payment at remaining balance", () => {
    const smallLiability = {
      ...sampleLiabilities[0],
      balance: 1000,
      monthlyPayment: 5000,
    };
    const result = amortizeLiability(smallLiability, 2026);
    expect(result.annualPayment).toBeCloseTo(1065, 0);
    expect(result.endingBalance).toBe(0);
  });
});

describe("computeLiabilities", () => {
  it("returns total annual liability payments and updated balances", () => {
    const result = computeLiabilities(sampleLiabilities, 2026);
    expect(result.totalPayment).toBe(30000);
    expect(result.updatedLiabilities).toHaveLength(1);
    expect(result.updatedLiabilities[0].balance).toBeCloseTo(289500, 0);
  });

  it("returns zero for empty liabilities", () => {
    const result = computeLiabilities([], 2026);
    expect(result.totalPayment).toBe(0);
    expect(result.updatedLiabilities).toHaveLength(0);
  });
});

describe("amortizeLiability with extra payments", () => {
  it("per-payment extra increases annual payment and reduces balance faster", () => {
    const liab = {
      ...sampleLiabilities[0],
      extraPayments: [
        { id: "ep1", liabilityId: "liab-mortgage", year: 2026, type: "per_payment" as const, amount: 200 },
      ],
    };
    const result = amortizeLiability(liab, 2026);
    const baseline = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.annualPayment).toBeGreaterThan(baseline.annualPayment);
    expect(result.endingBalance).toBeLessThan(baseline.endingBalance);
  });

  it("lump sum reduces ending balance by the lump amount", () => {
    const liab = {
      ...sampleLiabilities[0],
      extraPayments: [
        { id: "ep1", liabilityId: "liab-mortgage", year: 2026, type: "lump_sum" as const, amount: 10000 },
      ],
    };
    const result = amortizeLiability(liab, 2026);
    const baseline = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.endingBalance).toBeCloseTo(baseline.endingBalance - 10000, 0);
  });

  it("extra payment in a different year has no effect", () => {
    const liab = {
      ...sampleLiabilities[0],
      extraPayments: [
        { id: "ep1", liabilityId: "liab-mortgage", year: 2030, type: "lump_sum" as const, amount: 50000 },
      ],
    };
    const result = amortizeLiability(liab, 2026);
    const baseline = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.endingBalance).toBeCloseTo(baseline.endingBalance, 0);
  });

  it("uses termMonths to determine end year", () => {
    const liab = {
      ...sampleLiabilities[0],
      termMonths: 12, // 1-year term
    };
    const result = amortizeLiability(liab, 2027);
    expect(result.annualPayment).toBe(0);
    expect(result.endingBalance).toBe(0);
  });
});
