import { describe, it, expect } from "vitest";
import { computeAmortizationSchedule } from "@/lib/loan-math";

describe("computeAmortizationSchedule reports its payment months", () => {
  it("a January loan pays all twelve months from month 1", () => {
    const rows = computeAmortizationSchedule(100_000, 0.05, 1_000, 2026, 360, [], 1);
    expect(rows[0].firstPaymentMonth).toBe(1);
    expect(rows[0].paymentCount).toBe(12);
  });

  it("an October loan makes three payments in its origination year, starting in month 10", () => {
    const rows = computeAmortizationSchedule(100_000, 0.05, 1_000, 2026, 360, [], 10);
    expect(rows[0].firstPaymentMonth).toBe(10);
    expect(rows[0].paymentCount).toBe(3);
    // Every later year is a full twelve starting in January.
    expect(rows[1].firstPaymentMonth).toBe(1);
    expect(rows[1].paymentCount).toBe(12);
  });

  it("the payoff year reports only the months it actually paid", () => {
    // 18 months of term from a January start: year two pays Jan-Jun = 6.
    const rows = computeAmortizationSchedule(18_000, 0, 1_000, 2026, 18, [], 1);
    const last = rows[rows.length - 1];
    expect(last.year).toBe(2027);
    expect(last.firstPaymentMonth).toBe(1);
    expect(last.paymentCount).toBe(6);
  });

  // This identity — payment === monthlyPayment * paymentCount — holds for the
  // origination year and ordinary mid-life years, but not universally: it
  // breaks at payoff (the final payment is whatever clears the balance, not
  // the scheduled amount) and at endYear (a dust-absorb step folds the
  // residual balance into `payment` with no matching extra month). The
  // assertion is deliberately taken on the origination year (rows[0]) to
  // avoid both of those cases.
  it("paymentCount is consistent with the row's own payment total", () => {
    const rows = computeAmortizationSchedule(100_000, 0.05, 1_000, 2026, 360, [], 10);
    expect(rows[0].payment).toBeCloseTo(1_000 * rows[0].paymentCount, 6);
  });
});

/**
 * The identity above is deliberately taken on the origination year because the
 * `endYear` dust-absorb step (`loan-math.ts:259-267`) breaks it: it adds the
 * residual balance straight onto `payment` with no matching extra month. That
 * is correct — the block runs after the month-counting loop closes — but nothing
 * pinned it, and `src/lib/solver/monthly-allocation.ts` divides `payment` by
 * `paymentCount` to place a loan's monthly outflow. An edit that incremented the
 * counter inside the dust block would quietly hand the allocator a thirteenth
 * month and stop it reconciling.
 */
describe("computeAmortizationSchedule — paymentCount vs the dust-absorb step", () => {
  // The dust fixture from loan-math.test.ts:177. $300k at 6.5% for 360 months
  // has a theoretical payment of ~$1896.203; storing $1896.20 leaves ~$4.50 of
  // dust for the final year to absorb.
  const underPaid = 1896.2;
  const rows = computeAmortizationSchedule(300_000, 0.065, underPaid, 2026, 360);
  const last = rows[rows.length - 1];
  const penultimate = rows[rows.length - 2];

  it("the final row really does absorb dust (otherwise this suite proves nothing)", () => {
    expect(last.endingBalance).toBe(0);
    expect(last.payment).toBeGreaterThan(underPaid * 12);
    expect(last.payment - penultimate.payment).toBeGreaterThan(1);
  });

  it("counts twelve payments in the final year — the dust bought no extra month", () => {
    expect(last.paymentCount).toBe(12);
  });
});
