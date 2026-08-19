import { describe, it, expect } from "vitest";
import { calcPayment } from "@/lib/loan-math";
import {
  simulatePaydown,
  MAX_PAYDOWN_MONTHS,
  type PaydownDebt,
} from "@/lib/calculators/debt-paydown";

const START = { startYear: 2026, startMonth: 1 as const };

/** Minimums only, no rolling, no extra — the "do nothing" reference. */
function baseline(debts: PaydownDebt[]) {
  return simulatePaydown(debts, {
    ...START,
    strategy: "avalanche",
    extraMonthly: 0,
    roll: false,
  });
}

describe("simulatePaydown — one debt against the closed form", () => {
  it("clears a 60-month loan in 60 months for the textbook interest", () => {
    // calcPayment gives the payment that amortizes exactly, so total paid is
    // known without re-deriving it from the simulator under test.
    const payment = calcPayment(10_000, 0.06, 60);
    const run = baseline([
      { id: "d1", name: "Loan", balance: 10_000, annualRate: 0.06, minimumPayment: payment },
    ]);

    expect(run.monthsToDebtFree).toBe(60);
    expect(run.totalInterest).toBeCloseTo(payment * 60 - 10_000, 1);
    expect(run.balanceSeries[0]).toBeCloseTo(10_000, 2);
    expect(run.balanceSeries.at(-1)).toBe(0);
    expect(run.perDebt[0].payoffMonth).toBe(60);
    expect(run.neverPaysOff).toBe(false);
  });

  it("amortizes a 0% debt linearly", () => {
    const run = baseline([
      { id: "d1", name: "Promo card", balance: 1_200, annualRate: 0, minimumPayment: 100 },
    ]);
    expect(run.monthsToDebtFree).toBe(12);
    expect(run.totalInterest).toBeCloseTo(0, 6);
  });
});

describe("simulatePaydown — the rolling pool", () => {
  const debts: PaydownDebt[] = [
    { id: "small", name: "Store card", balance: 1_000, annualRate: 0.2, minimumPayment: 100 },
    { id: "big", name: "Auto loan", balance: 5_000, annualRate: 0.06, minimumPayment: 150 },
  ];

  // The one test that fails if the pool is never built. Without rolling, all
  // three strategies would silently produce identical numbers.
  it("beats the baseline on interest even with no extra payment", () => {
    const plan = simulatePaydown(debts, { ...START, strategy: "avalanche", extraMonthly: 0 });
    const base = baseline(debts);
    expect(plan.totalInterest).toBeLessThan(base.totalInterest);
    expect(plan.monthsToDebtFree).toBeLessThan(base.monthsToDebtFree);
  });
});

describe("simulatePaydown — strategy order", () => {
  // The high rate sits on the LARGER balance, so avalanche and snowball
  // genuinely disagree about what to attack first.
  const debts: PaydownDebt[] = [
    { id: "a", name: "Big card", balance: 8_000, annualRate: 0.22, minimumPayment: 200 },
    { id: "b", name: "Small loan", balance: 1_500, annualRate: 0.06, minimumPayment: 50 },
  ];
  const opts = { ...START, extraMonthly: 300 };

  it("avalanche costs less interest, snowball clears the small debt sooner", () => {
    const av = simulatePaydown(debts, { ...opts, strategy: "avalanche" });
    const sn = simulatePaydown(debts, { ...opts, strategy: "snowball" });

    expect(av.totalInterest).toBeLessThan(sn.totalInterest);

    const avB = av.perDebt.find((d) => d.id === "b")!.payoffMonth!;
    const snB = sn.perDebt.find((d) => d.id === "b")!.payoffMonth!;
    expect(snB).toBeLessThan(avB);
  });

  it("never lets the total balance rise on a run that pays off", () => {
    const av = simulatePaydown(debts, { ...opts, strategy: "avalanche" });
    for (let i = 1; i < av.balanceSeries.length; i++) {
      expect(av.balanceSeries[i]).toBeLessThanOrEqual(av.balanceSeries[i - 1] + 1e-6);
    }
  });
});

describe("simulatePaydown — equally", () => {
  it("splits the pool and redistributes what a cleared debt could not absorb", () => {
    // 0% throughout so the arithmetic is exact and checkable by hand.
    // Month 1: minimums take A to 90, B and C to 990. Pool = 300, share 100:
    // A absorbs 90 and clears, leaving 10 to re-split 5/5 across B and C.
    const run = simulatePaydown(
      [
        { id: "a", name: "A", balance: 100, annualRate: 0, minimumPayment: 10 },
        { id: "b", name: "B", balance: 1_000, annualRate: 0, minimumPayment: 10 },
        { id: "c", name: "C", balance: 1_000, annualRate: 0, minimumPayment: 10 },
      ],
      { ...START, strategy: "equally", extraMonthly: 300 },
    );

    expect(run.perDebt.find((d) => d.id === "a")!.payoffMonth).toBe(1);
    expect(run.balanceSeries[1]).toBeCloseTo(1_770, 6);
  });
});

describe("simulatePaydown — a debt that can never be paid off", () => {
  it("stops at the ceiling and names the debt instead of looping", () => {
    // $100/mo of interest against a $50 minimum.
    const run = simulatePaydown(
      [{ id: "cc", name: "Visa", balance: 5_000, annualRate: 0.24, minimumPayment: 50 }],
      { ...START, strategy: "avalanche", extraMonthly: 0 },
    );
    expect(run.neverPaysOff).toBe(true);
    expect(run.stalledDebtIds).toEqual(["cc"]);
    expect(run.monthsToDebtFree).toBe(MAX_PAYDOWN_MONTHS);
  });
});

describe("simulatePaydown — the yearly rows", () => {
  it("reconciles principal to the starting balance and ends at zero", () => {
    const debts: PaydownDebt[] = [
      { id: "a", name: "Card", balance: 4_000, annualRate: 0.18, minimumPayment: 150 },
      { id: "b", name: "Auto", balance: 12_000, annualRate: 0.055, minimumPayment: 320 },
    ];
    const run = simulatePaydown(debts, { ...START, strategy: "avalanche", extraMonthly: 250 });

    const principal = run.yearly.reduce((s, y) => s + y.principal, 0);
    const interest = run.yearly.reduce((s, y) => s + y.interest, 0);
    expect(principal).toBeCloseTo(16_000, 2);
    expect(interest).toBeCloseTo(run.totalInterest, 2);
    expect(run.yearly.at(-1)!.endingBalance).toBe(0);
    expect(run.yearly[0].year).toBe(2026);
  });
});

describe("simulatePaydown — nothing to pay down", () => {
  it("returns an empty run for no debts", () => {
    const run = simulatePaydown([], { ...START, strategy: "avalanche", extraMonthly: 0 });
    expect(run.monthsToDebtFree).toBe(0);
    expect(run.neverPaysOff).toBe(false);
    expect(run.yearly).toEqual([]);
  });
});
