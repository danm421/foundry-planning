import { describe, it, expect } from "vitest";
import {
  calcPayment,
  calcTerm,
  calcRate,
  calcInterestOnlyPayment,
  isInterestOnlyPayment,
  calcOriginalBalance,
  computeAmortizationSchedule,
  scheduleEndYear,
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

describe("calcInterestOnlyPayment", () => {
  it("returns one month of accrued interest", () => {
    // $500,000 at 6% → 500000 × 0.06 / 12
    expect(calcInterestOnlyPayment(500000, 0.06)).toBeCloseTo(2500, 2);
  });

  it("returns 0 when there is no balance or no rate to accrue", () => {
    expect(calcInterestOnlyPayment(0, 0.06)).toBe(0);
    expect(calcInterestOnlyPayment(500000, 0)).toBe(0);
  });
});

describe("isInterestOnlyPayment", () => {
  it("recognizes a payment stored as accrued interest rounded to cents", () => {
    // 500000 × 0.065 / 12 = 2708.333…, stored as 2708.33
    expect(isInterestOnlyPayment(500000, 0.065, 2708.33)).toBe(true);
  });

  it("rejects an amortizing payment", () => {
    expect(isInterestOnlyPayment(300000, 0.065, 1896.2)).toBe(false);
  });

  it("rejects a zero-rate loan whose payment is also zero", () => {
    expect(isInterestOnlyPayment(300000, 0, 0)).toBe(false);
  });
});

describe("computeAmortizationSchedule — interest-only payment", () => {
  it("holds the balance flat and balloons the principal at maturity", () => {
    const payment = calcInterestOnlyPayment(500000, 0.06); // 2500/mo
    const rows = computeAmortizationSchedule(500000, 0.06, payment, 2026, 60);

    expect(rows).toHaveLength(5);
    expect(rows[0].principal).toBeCloseTo(0, 2);
    expect(rows[0].interest).toBeCloseTo(30000, 2);
    expect(rows[0].endingBalance).toBeCloseTo(500000, 2);

    const last = rows[rows.length - 1];
    expect(last.principal).toBeCloseTo(500000, 2);
    expect(last.endingBalance).toBe(0);
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

  it("final year pays off dust balance from under-calibrated payment", () => {
    // $300k at 6.5% for 360 months has a theoretical payment of ~$1896.203.
    // Rounding to $1896.20 leaves ~$1 of dust over 30 years. The final
    // period should absorb that dust so the schedule ends at exactly 0.
    const underPaid = 1896.2;
    const rows = computeAmortizationSchedule(300000, 0.065, underPaid, 2026, 360);
    const last = rows[rows.length - 1];
    expect(last.endingBalance).toBe(0);
  });

  it("extra payments never push balance negative", () => {
    const payment = calcPayment(120000, 0.06, 240);
    const rows = computeAmortizationSchedule(120000, 0.06, payment, 2026, 240, [
      // Deliberately huge lump sum — should cap at remaining balance
      { year: 2030, type: "lump_sum", amount: 10_000_000 },
    ]);
    for (const row of rows) {
      expect(row.endingBalance).toBeGreaterThanOrEqual(0);
    }
    // Lump-sum year should zero out the loan
    const payoffRow = rows.find((r) => r.year === 2030);
    expect(payoffRow?.endingBalance).toBe(0);
  });

  it("startMonth=7 makes only 6 payments (Jul–Dec) in the first calendar year", () => {
    // $300k @ 6.5%, $1896.20/mo, originating July 2020. The first calendar
    // year (2020) should amortize 6 months, not a full 12. After 6 payments
    // the balance is ~$298,350.61; a buggy 12-payment first year would
    // over-amortize down to ~$296,646.87.
    const rows = computeAmortizationSchedule(
      300000,
      0.065,
      1896.2,
      2020,
      360,
      [],
      7,
    );
    const firstYear = rows[0];
    expect(firstYear.year).toBe(2020);
    // 6 payments of $1896.20 = $11,377.20 scheduled in the first calendar year
    expect(firstYear.payment).toBeCloseTo(1896.2 * 6, 2);
    // 6-payment ending balance, not the 12-payment over-amortized value
    expect(firstYear.endingBalance).toBeCloseTo(298350.61, 0);
    expect(firstYear.endingBalance).toBeGreaterThan(296646.87 + 1);
  });

  it("startMonth=1 (default) is unchanged — full 12 payments in the first year", () => {
    const explicit = computeAmortizationSchedule(
      300000,
      0.065,
      1896.2,
      2020,
      360,
      [],
      1,
    );
    const implicit = computeAmortizationSchedule(300000, 0.065, 1896.2, 2020, 360);
    // Passing startMonth=1 must produce an identical schedule to omitting it.
    expect(explicit).toEqual(implicit);
    // First calendar year amortizes a full 12 payments.
    expect(implicit[0].payment).toBeCloseTo(1896.2 * 12, 2);
  });
});

describe("scheduleEndYear", () => {
  it("ends a January loan on the last month of its term", () => {
    // Jan 2024 + 60 months runs through Dec 2028.
    expect(scheduleEndYear(2024, 60, 1)).toBe(2028);
    // Omitting startMonth must stay identical to passing January.
    expect(scheduleEndYear(2024, 60)).toBe(2028);
  });

  it("carries a mid-year loan into the calendar year its term actually ends", () => {
    // Oct 2024 + 60 months runs through Sep 2029, not Dec 2028.
    expect(scheduleEndYear(2024, 60, 10)).toBe(2029);
    // Jul 2020 + 360 months runs through Jun 2050, not Dec 2049.
    expect(scheduleEndYear(2020, 360, 7)).toBe(2050);
    // Dec 2024 + 12 months runs through Nov 2025.
    expect(scheduleEndYear(2024, 12, 12)).toBe(2025);
  });
});

describe("computeAmortizationSchedule — mid-year origination pays its real term", () => {
  // The Auto Loan from the reported bug: $35,184.27 originated Oct 2024,
  // 60 months at 1.99%, $616.55/mo. Its last payment is Sep 2029.
  const ORIG = 35184.27;
  const RATE = 0.0199;
  const PMT = 616.55;

  it("does not collapse the tail of the term into a phantom balloon", () => {
    const rows = computeAmortizationSchedule(ORIG, RATE, PMT, 2024, 60, [], 10);

    // No calendar year may pay more than twelve scheduled payments. The
    // defect dumped the whole unpaid balance into the final year: 2028 was
    // charged $12,902 against a normal $7,399 year.
    for (const row of rows) {
      expect(row.payment).toBeLessThanOrEqual(PMT * 12 + 0.01);
    }
  });

  it("runs through the calendar year of the final payment", () => {
    const rows = computeAmortizationSchedule(ORIG, RATE, PMT, 2024, 60, [], 10);
    expect(rows[rows.length - 1].year).toBe(2029);
    expect(rows[rows.length - 1].endingBalance).toBe(0);
    // Oct–Dec 2024 is three payments; Jan–Sep 2029 is nine.
    expect(rows[0].payment).toBeCloseTo(PMT * 3, 2);
    expect(rows[rows.length - 1].payment).toBeCloseTo(PMT * 9, 0);
  });

  it("pays exactly the contractual number of payments", () => {
    const rows = computeAmortizationSchedule(ORIG, RATE, PMT, 2024, 60, [], 10);
    const total = rows.reduce((sum, r) => sum + r.payment, 0);
    expect(total).toBeCloseTo(PMT * 60, 0);
  });
});
