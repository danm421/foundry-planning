import { describe, it, expect } from "vitest";
import {
  projectSavings,
  solveMonthlyForGoal,
  monthsToJanuary,
  type SavingsGoalInput,
} from "../savings-goal";

/**
 * The spec's pinned worked example: $80,000 in today's dollars, $12,000 set
 * aside, Moderate 6%, plan inflation 3%, run from Aug 2026 to Jan 2036.
 */
const PINNED = {
  targetToday: 80_000,
  months: 113,
  currentSavings: 12_000,
  annualReturn: 0.06,
  inflationRate: 0.03,
} as const;

const withPmt = (pmt: number, over: Partial<SavingsGoalInput> = {}): SavingsGoalInput => ({
  ...PINNED,
  monthlyContribution: pmt,
  ...over,
});

describe("monthsToJanuary", () => {
  it("counts from this month to January of the target year", () => {
    // Aug 2026 -> Jan 2036 is 10 years less the 7 months already elapsed.
    expect(monthsToJanuary(2026, 8, 2036)).toBe(113);
    expect(monthsToJanuary(2026, 1, 2027)).toBe(12);
  });

  it("goes non-positive once the target year is here or past", () => {
    expect(monthsToJanuary(2026, 8, 2026)).toBe(-7);
    expect(monthsToJanuary(2026, 1, 2026)).toBe(0);
  });
});

describe("solveMonthlyForGoal", () => {
  it("solves the pinned example to the dollar", () => {
    expect(solveMonthlyForGoal(PINNED)).toBeCloseTo(561.41, 2);
  });

  it("round-trips through the projector to the cent", () => {
    // The solve is closed-form algebra; the projector is a month-by-month
    // loop. They are independent implementations, so agreement is real
    // evidence — break either and this fails.
    const required = solveMonthlyForGoal(PINNED);
    const run = projectSavings(withPmt(required));
    expect(run.projected).toBeCloseTo(run.targetAtGoal, 2);
    expect(run.percentFunded).toBeCloseTo(1, 6);
    expect(run.shortfall).toBeCloseTo(0, 2);
  });

  it("degenerates to a straight line at a zero return", () => {
    const flat = { ...PINNED, annualReturn: 0, inflationRate: 0 };
    expect(solveMonthlyForGoal(flat)).toBeCloseTo((80_000 - 12_000) / 113, 6);
  });

  it("returns 0 rather than a negative when the goal is already funded", () => {
    expect(solveMonthlyForGoal({ ...PINNED, currentSavings: 500_000 })).toBe(0);
  });

  it("returns 0 for a goal that is already due, instead of dividing by zero", () => {
    const now = solveMonthlyForGoal({ ...PINNED, months: 0 });
    expect(Number.isFinite(now)).toBe(true);
    expect(now).toBe(0);
  });
});

describe("projectSavings", () => {
  it("inflates the goal, and leaves it alone at zero inflation", () => {
    expect(projectSavings(withPmt(0)).targetAtGoal).toBeCloseTo(106_078, 0);
    expect(
      projectSavings(withPmt(0, { inflationRate: 0 })).targetAtGoal,
    ).toBeCloseTo(80_000, 6);
  });

  it("indexes both series from today and keeps them the same length", () => {
    const run = projectSavings(withPmt(200));
    expect(run.balanceSeries).toHaveLength(114); // months + 1
    expect(run.targetSeries).toHaveLength(114);
    expect(run.balanceSeries[0]).toBe(12_000);
    expect(run.targetSeries[0]).toBe(80_000);
  });

  it("reconciles: start + contributions + growth == the projected balance", () => {
    const run = projectSavings(withPmt(200));
    expect(run.totalContributed).toBeCloseTo(200 * 113, 6);
    expect(12_000 + run.totalContributed + run.growth).toBeCloseTo(run.projected, 6);
  });

  it("reports the shortfall the spec's worked example quotes", () => {
    const run = projectSavings(withPmt(200));
    expect(run.projected).toBeCloseTo(51_363, 0);
    expect(run.shortfall).toBeCloseTo(54_715, 0);
    expect(run.percentFunded).toBeCloseTo(0.484, 2);
    expect(run.surplus).toBe(0);
  });

  it("RACES the moving goal — a frozen target would answer 98 months early", () => {
    // The whole point of targetSeries. At $200/mo the balance passes the
    // ORIGINAL $80,000 at month 168, but does not overtake the INFLATING
    // goal until month 266.
    const run = projectSavings(withPmt(200));
    expect(run.monthsToGoal).toBe(266);

    // The frozen-target crossing computed independently. It CANNOT be read
    // off `balanceSeries` — that series stops at the 113-month horizon and
    // never reaches $80,000, so `findIndex` would return -1 and this test
    // would assert nothing.
    let b = 12_000;
    let frozenCrossing = 0;
    while (b < 80_000) {
      b = b * (1 + 0.06 / 12) + 200;
      frozenCrossing += 1;
    }
    expect(frozenCrossing).toBe(168);
    // Not even in the same decade; no tolerance could absorb this.
    expect(run.monthsToGoal! - frozenCrossing).toBe(98);
  });

  it("returns null and terminates when the goal is never reached", () => {
    const run = projectSavings(withPmt(0, { currentSavings: 0, annualReturn: 0 }));
    expect(run.monthsToGoal).toBeNull();
    expect(run.balanceSeries).toHaveLength(PINNED.months + 1);
  });

  it("reports month 0 when the client is already there today", () => {
    expect(projectSavings(withPmt(0, { currentSavings: 200_000 })).monthsToGoal).toBe(0);
  });

  it("survives a goal that is already due", () => {
    const run = projectSavings(withPmt(0, { months: 0 }));
    expect(run.balanceSeries).toEqual([12_000]);
    expect(run.targetAtGoal).toBe(80_000);
    expect(run.shortfall).toBe(68_000);
    expect(Number.isFinite(run.percentFunded)).toBe(true);
  });

  it("treats a zero-cost goal as fully funded rather than dividing by zero", () => {
    const run = projectSavings(withPmt(0, { targetToday: 0, currentSavings: 0 }));
    expect(run.percentFunded).toBe(1);
    expect(run.shortfall).toBe(0);
  });

  // The fifty-year ceiling from BOTH sides, on a straight line so the crossing
  // month is arithmetic rather than a compounding artefact: at $1/mo from zero
  // the balance meets a flat goal on the month whose number equals the goal.
  // The months are written as LITERALS on purpose — expressed in terms of
  // MAX_SAVINGS_MONTHS the pair moves with the constant and cannot see it
  // change, which is the very thing the test it replaced got wrong. A ceiling
  // one month lower loses the 600 case; one month higher, or a search that
  // never stops, turns the 601 case into a date.
  it.each([
    [600, 600],
    [601, null],
  ])("a goal costing $%i is reached at month %s", (targetToday, expected) => {
    const run = projectSavings(
      withPmt(1, {
        targetToday,
        currentSavings: 0,
        annualReturn: 0,
        inflationRate: 0,
      }),
    );
    expect(run.monthsToGoal).toBe(expected);
  });
});
