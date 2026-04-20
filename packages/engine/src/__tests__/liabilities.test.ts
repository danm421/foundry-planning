import { describe, it, expect } from "vitest";
import { computeLiabilities, amortizeLiability } from "../liabilities";
import { sampleLiabilities } from "./fixtures";

describe("amortizeLiability", () => {
  it("computes annual payment, interest, and principal split", () => {
    // Monthly amortization: 300k @ 6.5% with $2,500/mo for one year yields
    // ~$19,181 interest and ~$10,819 principal (less interest than an
    // annual-compounding approximation because principal pays down each month).
    const result = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.annualPayment).toBe(30000);
    expect(result.interestPortion).toBeCloseTo(19181, 0);
    expect(result.principalPortion).toBeCloseTo(10819, 0);
    expect(result.endingBalance).toBeCloseTo(289181, 0);
  });

  it("returns zero for years outside liability range", () => {
    const result = amortizeLiability(sampleLiabilities[0], 2046);
    expect(result.annualPayment).toBe(0);
    expect(result.endingBalance).toBe(0);
  });

  it("caps payment at remaining balance", () => {
    // With a $1,000 balance and $5,000/mo payment, month-1 pays the loan off:
    // interest on $1,000 at 6.5%/12 = ~$5.42, principal = $1,000. Annual
    // payment ≈ $1,005.42, ending balance = 0.
    const smallLiability = {
      ...sampleLiabilities[0],
      balance: 1000,
      monthlyPayment: 5000,
    };
    const result = amortizeLiability(smallLiability, 2026);
    expect(result.annualPayment).toBeCloseTo(1005, 0);
    expect(result.endingBalance).toBe(0);
  });
});

describe("computeLiabilities", () => {
  it("returns total annual liability payments and updated balances", () => {
    const result = computeLiabilities(sampleLiabilities, 2026);
    expect(result.totalPayment).toBe(30000);
    expect(result.updatedLiabilities).toHaveLength(1);
    expect(result.updatedLiabilities[0].balance).toBeCloseTo(289181, 0);
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

  it("lump sum reduces ending balance by at least the lump amount", () => {
    // A $10k lump sum applied at the first month reduces ending balance by
    // the lump amount plus the interest that would have accrued on it for the
    // remainder of the year — so the delta is slightly more than $10k.
    const liab = {
      ...sampleLiabilities[0],
      extraPayments: [
        { id: "ep1", liabilityId: "liab-mortgage", year: 2026, type: "lump_sum" as const, amount: 10000 },
      ],
    };
    const result = amortizeLiability(liab, 2026);
    const baseline = amortizeLiability(sampleLiabilities[0], 2026);
    const delta = baseline.endingBalance - result.endingBalance;
    expect(delta).toBeGreaterThanOrEqual(10000);
    expect(delta).toBeLessThan(10800); // capped by a year of interest on $10k @ 6.5%
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
