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
    const result = amortizeLiability(sampleLiabilities[0], 2047);
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
