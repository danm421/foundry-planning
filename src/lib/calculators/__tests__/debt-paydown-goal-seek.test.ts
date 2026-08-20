import { describe, it, expect } from "vitest";
import {
  comparePaydown,
  monthLabel,
  monthsUntil,
  simulatePaydown,
  solveExtraForTarget,
  type PaydownDebt,
} from "@/lib/calculators/debt-paydown";

const START = { startYear: 2026, startMonth: 8 };

const DEBTS: PaydownDebt[] = [
  { id: "a", name: "Big card", balance: 8_000, annualRate: 0.22, minimumPayment: 200 },
  { id: "b", name: "Auto", balance: 12_000, annualRate: 0.055, minimumPayment: 320 },
];

describe("monthLabel / monthsUntil", () => {
  it("counts the start month as month 1", () => {
    expect(monthLabel(2026, 8, 1)).toBe("2026-08");
    expect(monthLabel(2026, 8, 5)).toBe("2026-12");
    expect(monthLabel(2026, 8, 6)).toBe("2027-01");
  });

  it("round-trips against monthsUntil", () => {
    const n = monthsUntil(2026, 8, "2032-03");
    expect(n).toBe(68);
    expect(monthLabel(2026, 8, n)).toBe("2032-03");
  });
});

describe("comparePaydown", () => {
  it("saves interest and months against minimums paid separately", () => {
    const cmp = comparePaydown(DEBTS, { ...START, strategy: "avalanche", extraMonthly: 250 });

    expect(cmp.baseline.totalInterest).toBeGreaterThan(cmp.plan.totalInterest);
    expect(cmp.interestSaved).toBeCloseTo(
      cmp.baseline.totalInterest - cmp.plan.totalInterest,
      6,
    );
    expect(cmp.monthsSaved).toBe(
      cmp.baseline.monthsToDebtFree - cmp.plan.monthsToDebtFree,
    );
    expect(cmp.debtFreeMonth).toBe(
      monthLabel(2026, 8, cmp.plan.monthsToDebtFree),
    );
  });

  it("leaves the baseline untouched by the extra payment", () => {
    const a = comparePaydown(DEBTS, { ...START, strategy: "avalanche", extraMonthly: 0 });
    const b = comparePaydown(DEBTS, { ...START, strategy: "avalanche", extraMonthly: 900 });
    expect(a.baseline.totalInterest).toBeCloseTo(b.baseline.totalInterest, 6);
  });

  it("gives no date when the plan never pays off", () => {
    // $100/mo of interest against a $50 minimum: the plan itself stalls, so a
    // debt-free date would be a confident number for a plan that has none.
    const stalling: PaydownDebt[] = [
      { id: "cc", name: "Visa", balance: 5_000, annualRate: 0.24, minimumPayment: 50 },
    ];
    const cmp = comparePaydown(stalling, { ...START, strategy: "avalanche", extraMonthly: 0 });
    expect(cmp.plan.neverPaysOff).toBe(true);
    expect(cmp.debtFreeMonth).toBeNull();
  });
});

describe("solveExtraForTarget", () => {
  it("finds a payment that hits the target, and the dollar below it does not", () => {
    const noExtra = simulatePaydown(DEBTS, {
      ...START,
      strategy: "avalanche",
      extraMonthly: 0,
    });
    const target = Math.floor(noExtra.monthsToDebtFree / 2);

    const solved = solveExtraForTarget(DEBTS, "avalanche", target, 2026, 8);
    expect(solved.alreadyOnTrack).toBe(false);
    expect(solved.unreachable).toBe(false);
    expect(solved.extraMonthly).toBeGreaterThan(0);
    expect(solved.monthsToDebtFree).toBeLessThanOrEqual(target);

    // The search narrows to a bracket under $1 before rounding up, so two
    // dollars below the answer is always inside the known-insufficient half.
    const under = simulatePaydown(DEBTS, {
      ...START,
      strategy: "avalanche",
      extraMonthly: solved.extraMonthly - 2,
    });
    expect(under.monthsToDebtFree).toBeGreaterThan(target);
  });

  it("asks for nothing when the target is already met", () => {
    const solved = solveExtraForTarget(DEBTS, "avalanche", 600, 2026, 8);
    expect(solved.alreadyOnTrack).toBe(true);
    expect(solved.extraMonthly).toBe(0);
    expect(solved.unreachable).toBe(false);
  });

  it("still answers when a debt cannot be paid off on its minimum alone", () => {
    const stalling: PaydownDebt[] = [
      { id: "cc", name: "Visa", balance: 5_000, annualRate: 0.24, minimumPayment: 50 },
    ];
    const solved = solveExtraForTarget(stalling, "avalanche", 24, 2026, 8);
    expect(solved.alreadyOnTrack).toBe(false);
    expect(solved.unreachable).toBe(false);
    expect(solved.monthsToDebtFree).toBeLessThanOrEqual(24);
  });

  it("reports unreachable when even the whole balance as extra cannot hit the target", () => {
    // Paying the entire $5,000 balance as extra still leaves a real
    // month-one interest charge to absorb first (see the doc comment on
    // solveExtraForTarget): the debt clears in month 2, not month 1, so a
    // 1-month target is provably out of reach no matter the payment.
    const stalling: PaydownDebt[] = [
      { id: "cc", name: "Visa", balance: 5_000, annualRate: 0.24, minimumPayment: 50 },
    ];
    const solved = solveExtraForTarget(stalling, "avalanche", 1, 2026, 8);
    expect(solved.unreachable).toBe(true);
    expect(solved.alreadyOnTrack).toBe(false);
  });
});
