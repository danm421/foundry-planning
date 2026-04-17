import { describe, it, expect } from "vitest";
import {
  calcPayment,
  calcTerm,
  calcRate,
  calcOriginalBalance,
  computeAmortizationSchedule,
} from "../loan-math";

describe("calcPayment", () => {
  it("computes monthly payment for a 30-year mortgage", () => {
    // $300,000 at 6.5% for 360 months
    const payment = calcPayment(300000, 0.065, 360);
    expect(payment).toBeCloseTo(1896.2, 0);
  });

  it("returns balance / term when rate is zero", () => {
    const payment = calcPayment(120000, 0, 240);
    expect(payment).toBeCloseTo(500, 2);
  });
});

describe("calcTerm", () => {
  it("computes term for a 30-year mortgage", () => {
    const term = calcTerm(300000, 0.065, 1896.2);
    expect(term).toBeCloseTo(360, 0);
  });

  it("returns Infinity when payment does not cover interest", () => {
    // Interest = 300000 * 0.065/12 = 1625/mo, payment = 1000
    const term = calcTerm(300000, 0.065, 1000);
    expect(term).toBe(Infinity);
  });

  it("returns balance / payment when rate is zero", () => {
    const term = calcTerm(120000, 0, 500);
    expect(term).toBe(240);
  });
});

describe("calcRate", () => {
  it("solves for rate on a 30-year mortgage", () => {
    const rate = calcRate(300000, 360, 1896.2);
    expect(rate).toBeCloseTo(0.065, 3);
  });

  it("returns 0 when payment equals balance / term (zero interest)", () => {
    const rate = calcRate(120000, 240, 500);
    expect(rate).toBeCloseTo(0, 3);
  });

  it("returns null when solver cannot converge", () => {
    // Payment less than any positive-rate amortization of this balance/term
    const rate = calcRate(1000000, 12, 1);
    expect(rate).toBeNull();
  });
});

describe("calcOriginalBalance", () => {
  it("recovers original balance from current balance and elapsed months", () => {
    // A $300k loan at 6.5% for 360 months, after 48 months
    const payment = calcPayment(300000, 0.065, 360);
    // Simulate 48 months of payments to get the balance
    let bal = 300000;
    const r = 0.065 / 12;
    for (let i = 0; i < 48; i++) {
      bal = bal * (1 + r) - payment;
    }
    // Now back-calculate
    const original = calcOriginalBalance(bal, 0.065, payment, 48);
    expect(original).toBeCloseTo(300000, 0);
  });

  it("returns currentBalance when no months elapsed", () => {
    const result = calcOriginalBalance(300000, 0.065, 2000, 0);
    expect(result).toBe(300000);
  });

  it("handles zero interest rate", () => {
    const result = calcOriginalBalance(100000, 0, 1000, 24);
    expect(result).toBe(124000);
  });
});

describe("computeAmortizationSchedule", () => {
  it("produces correct number of rows for a simple loan", () => {
    const rows = computeAmortizationSchedule(120000, 0.06, 1000, 2026, 240);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(rows[0].year).toBe(2026);
    expect(rows[0].beginningBalance).toBe(120000);
  });

  it("ending balance reaches zero by final row", () => {
    const payment = calcPayment(120000, 0.06, 240);
    const rows = computeAmortizationSchedule(120000, 0.06, payment, 2026, 240);
    const last = rows[rows.length - 1];
    expect(last.endingBalance).toBeCloseTo(0, 0);
  });

  it("per-payment extra shortens payoff", () => {
    const payment = calcPayment(120000, 0.06, 240);
    const noExtra = computeAmortizationSchedule(120000, 0.06, payment, 2026, 240);
    const withExtra = computeAmortizationSchedule(120000, 0.06, payment, 2026, 240, [
      { year: 2026, type: "per_payment", amount: 200 },
      { year: 2027, type: "per_payment", amount: 200 },
      { year: 2028, type: "per_payment", amount: 200 },
    ]);
    // Extra payments in early years reduce ending balance
    expect(withExtra[2].endingBalance).toBeLessThan(noExtra[2].endingBalance);
  });

  it("lump sum reduces balance in the target year", () => {
    const payment = calcPayment(300000, 0.065, 360);
    const rows = computeAmortizationSchedule(300000, 0.065, payment, 2026, 360, [
      { year: 2028, type: "lump_sum", amount: 50000 },
    ]);
    // Year 2028 (index 2) should show extra payment and reduced ending balance
    expect(rows[2].extraPayment).toBeGreaterThan(0);
    const noExtra = computeAmortizationSchedule(300000, 0.065, payment, 2026, 360);
    expect(rows[2].endingBalance).toBeLessThan(noExtra[2].endingBalance);
  });

  it("handles zero interest rate", () => {
    const rows = computeAmortizationSchedule(24000, 0, 1000, 2026, 24);
    expect(rows[0].interest).toBe(0);
    expect(rows[0].principal).toBe(12000);
    expect(rows[0].endingBalance).toBe(12000);
  });
});
