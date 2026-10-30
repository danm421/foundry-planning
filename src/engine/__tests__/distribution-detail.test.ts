import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, sampleAccounts } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, ProjectionYear } from "../types";

/**
 * `ProjectionYear.distributionDetail` — the reporting-only figures the Solver's
 * Distributions view reads (spec 2026-10-30). Each test pins a figure to the
 * engine field it must agree with, on a real projection.
 */

/** The base fixture's 401(k) as a Traditional IRA. A 401(k)'s `basis` never
 *  joins the Form 8606 pool, so only an IRA can carry after-tax basis into its
 *  RMD. `basis` 0 is a fully pre-tax IRA. */
function accountsWithIra(basis: number, overrides: Partial<Account> = {}): Account[] {
  return sampleAccounts.map((a) =>
    a.id === "acct-401k"
      ? { ...a, name: "John IRA", subType: "traditional_ira", basis, ...overrides }
      : a,
  );
}

function sumRmdAmount(y: ProjectionYear): number {
  return Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);
}

function firstRmdYear(years: ProjectionYear[]): ProjectionYear {
  const y = years.find((yr) => sumRmdAmount(yr) > 0);
  expect(y).toBeDefined();
  return y!;
}

describe("distributionDetail", () => {
  it("is present on every year, all zero on a plan with no RMD, goal or absorb lever", () => {
    const years = runProjection(
      buildClientData({ accounts: accountsWithIra(0, { rmdEnabled: false }) }),
    );
    expect(years.length).toBeGreaterThan(0);
    for (const y of years) {
      expect(y.distributionDetail).toBeDefined();
      expect(y.distributionDetail!.rmdInTotalIncome).toBe(0);
      expect(y.distributionDetail!.absorbedSurplus).toBe(0);
      expect(y.distributionDetail!.goalDrawsByAccount).toEqual({});
    }
  });

  it("rmdInTotalIncome equals household RMD cash for a pre-tax IRA", () => {
    const years = runProjection(buildClientData({ accounts: accountsWithIra(0) }));
    const y = firstRmdYear(years);
    expect(y.distributionDetail!.rmdInTotalIncome).toBeGreaterThan(0);
    expect(y.distributionDetail!.rmdInTotalIncome).toBeCloseTo(sumRmdAmount(y), 2);
  });

  it("rmdInTotalIncome is below RMD cash when the IRA has after-tax basis", () => {
    const years = runProjection(buildClientData({ accounts: accountsWithIra(100_000) }));
    const y = firstRmdYear(years);
    expect(y.distributionDetail!.rmdInTotalIncome).toBeGreaterThan(0);
    expect(y.distributionDetail!.rmdInTotalIncome).toBeLessThan(sumRmdAmount(y));
  });

  it("goalDrawsByAccount matches the goal's household draw and sits inside withdrawals", () => {
    const car: Expense = {
      id: "car",
      type: "other",
      name: "New car",
      annualAmount: 40_000,
      startYear: 2030,
      endYear: 2030,
      growthRate: 0,
      isGoal: true,
      dedicatedAccountIds: ["acct-brokerage"],
      payShortfallOutOfPocket: false,
    };
    const base = buildClientData();
    const years = runProjection({ ...base, expenses: [...base.expenses, car] });
    const y = years.find((yr) => yr.year === 2030)!;
    const goal = y.goals![0];
    expect(goal.goalId).toBe("car");
    expect(goal.householdWithdrawal).toBeGreaterThan(0);
    const draw = y.distributionDetail!.goalDrawsByAccount["acct-brokerage"];
    expect(draw).toBeCloseTo(goal.householdWithdrawal, 6);
    expect(draw).toBeLessThanOrEqual(y.withdrawals.byAccount["acct-brokerage"]);
  });

  it("absorbedSurplus is the top-up above the absorbing row's base", () => {
    // Same fixture as src/lib/solver/__tests__/monthly-cash-flow-split.test.ts:
    // the surplus phase only runs with a default checking account.
    const defaultChecking: Account = {
      id: "acct-checking",
      name: "Joint Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 10_000,
      basis: 10_000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const years = runProjection(
      buildClientData({
        accounts: [defaultChecking, ...sampleAccounts],
        expenses: [
          {
            id: "exp-living",
            type: "living",
            name: "Living Expenses",
            annualAmount: 80_000,
            startYear: 2026,
            endYear: 2055,
            growthRate: 0.03,
            absorbsRemainingCashFlow: true,
          },
        ],
      }),
    );
    const y = years[0];
    expect(y.year).toBe(2026);
    expect(y.distributionDetail!.absorbedSurplus).toBeGreaterThan(0);
    expect(y.expenses.living - y.distributionDetail!.absorbedSurplus).toBeCloseTo(80_000, 2);
  });
});
