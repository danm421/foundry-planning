import { describe, it, expect } from "vitest";
import {
  buildLiabilitySchedule,
  scheduleBoYBalance,
} from "../liability-schedules";
import type { Liability } from "../types";

// A 30-year, $300,000 mortgage at 6.5% with a $1,896.20/mo payment that
// originates in July 2020. balanceAsOf is set to origination so the stored
// $300,000 IS the original balance (elapsedMonths = 0, no back-calc applied) —
// isolating the forward-amortization behavior we're fixing.
const julyMortgage: Liability = {
  id: "liab-july-mortgage",
  name: "July Mortgage",
  balance: 300000,
  interestRate: 0.065,
  monthlyPayment: 1896.2,
  startYear: 2020,
  startMonth: 7,
  termMonths: 360,
  balanceAsOfYear: 2020,
  balanceAsOfMonth: 7,
  isInterestDeductible: true,
  extraPayments: [],
  owners: [],
};

describe("buildLiabilitySchedule — mid-year origination (startMonth)", () => {
  it("amortizes only 6 payments in the July-origination year", () => {
    const schedule = buildLiabilitySchedule(julyMortgage);
    const firstYear = schedule[0];
    expect(firstYear.year).toBe(2020);
    // Jul–Dec = 6 payments, not a full 12.
    expect(firstYear.payment).toBeCloseTo(1896.2 * 6, 2);
  });

  it("produces the correct planStartYear (2026) BoY balance", () => {
    // Through end of 2025 the loan makes 66 payments (6 in 2020 + 12×5).
    // Forward-amortizing $300,000 by 66 payments → $278,552.41. The buggy
    // 72-payment path (a full 12 in 2020) over-amortized to $276,196.46.
    const schedule = buildLiabilitySchedule(julyMortgage);
    const boy2026 = scheduleBoYBalance(schedule, 2026);
    expect(boy2026).toBeCloseTo(278552.41, 1);
    // Guard against the over-amortized value sneaking back in.
    expect(boy2026).toBeGreaterThan(276196.46 + 1);
  });
});

describe("buildLiabilitySchedule — January origination is unchanged", () => {
  // Same loan, but originating in January. The fix must not change anything
  // for a startMonth=1 loan.
  const januaryMortgage: Liability = {
    ...julyMortgage,
    id: "liab-jan-mortgage",
    startMonth: 1,
    balanceAsOfMonth: 1,
  };

  it("amortizes a full 12 payments in the first calendar year", () => {
    const schedule = buildLiabilitySchedule(januaryMortgage);
    expect(schedule[0].year).toBe(2020);
    expect(schedule[0].payment).toBeCloseTo(1896.2 * 12, 2);
  });

  it("BoY 2026 reflects 72 payments through end of 2025 (no regression)", () => {
    // A January 2020 loan genuinely makes 72 payments by end of 2025, so its
    // BoY 2026 balance legitimately equals the value the buggy July loan
    // wrongly produced ($276,196.46). This confirms the fix is scoped to the
    // first-year payment count, not the per-year math.
    const schedule = buildLiabilitySchedule(januaryMortgage);
    const boy2026 = scheduleBoYBalance(schedule, 2026);
    expect(boy2026).toBeCloseTo(276196.46, 1);
  });
});
