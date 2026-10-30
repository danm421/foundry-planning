import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData, sampleAccounts, sampleFamilyMembers } from "./fixtures";
import {
  FIRST_DEATH_YEAR,
  JANE_INHERITED_ROTH,
  iraSplitAtFirstDeath,
  iraToTrustAtFirstDeath,
} from "./_fixtures/survivor-iras";
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
      expect(y.distributionDetail!.rmdCashByAccount).toEqual({});
      expect(y.distributionDetail!.mintedAccountNames).toEqual({});
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

  describe("rmdCashByAccount", () => {
    const sumOf = (m: Record<string, number>) => Object.values(m).reduce((s, v) => s + v, 0);

    it("is each household IRA's RMD cash; on a pre-tax IRA it adds to rmdInTotalIncome", () => {
      const years = runProjection(buildClientData({ accounts: accountsWithIra(0) }));
      const y = firstRmdYear(years);
      const byAccount = y.distributionDetail!.rmdCashByAccount;
      expect(Object.keys(byAccount)).toEqual(["acct-401k"]);
      expect(byAccount["acct-401k"]).toBeCloseTo(y.accountLedgers["acct-401k"].rmdAmount, 6);
      expect(sumOf(byAccount)).toBeCloseTo(y.distributionDetail!.rmdInTotalIncome, 6);
    });

    it("carries an inherited Roth's tax-free payout — rmdInTotalIncome's other half", () => {
      const years = runProjection(
        buildClientData({ accounts: [...accountsWithIra(0, { rmdEnabled: false }), JANE_INHERITED_ROTH] }),
      );
      const y = years[0];
      const payout = y.accountLedgers[JANE_INHERITED_ROTH.id].rmdAmount;
      expect(payout).toBeGreaterThan(0);
      // Tax-free: none of it is in the 1040's RMD line, all of it is cash.
      expect(y.taxDetail!.bySource[`inherited_roth_tax_free:${JANE_INHERITED_ROTH.id}`]?.amount)
        .toBeCloseTo(payout, 6);
      expect(y.distributionDetail!.rmdCashByAccount[JANE_INHERITED_ROTH.id]).toBeCloseTo(payout, 6);
      expect(y.distributionDetail!.rmdInTotalIncome).toBeCloseTo(payout, 6);
    });

    it("leaves out an entity-owned IRA, whose RMD is the entity's cash", () => {
      const trust = [{ kind: "entity" as const, entityId: "ngt", percent: 1 }];
      const ira = (id: string, owners: Account["owners"]): Account => ({
        id, name: id, category: "retirement", subType: "traditional_ira", titlingType: "jtwros",
        value: 500_000, basis: 0, growthRate: 0, rmdEnabled: true, owners,
      });
      const checking = (id: string, owners: Account["owners"]): Account => ({
        id, name: id, category: "cash", subType: "checking", titlingType: "jtwros",
        value: 100_000, basis: 100_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true, owners,
      });
      const client = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];
      const years = runProjection(
        buildClientData({
          client: {
            firstName: "Trust", lastName: "Test", dateOfBirth: "1950-01-01",
            filingStatus: "single", retirementAge: 65, planEndAge: 95,
          },
          familyMembers: [{ ...sampleFamilyMembers[0], dateOfBirth: "1950-01-01" }],
          accounts: [
            checking("acct-checking", client),
            checking("acct-trust-checking", trust),
            ira("acct-trust-ira", trust),
            ira("acct-ira", client),
          ],
          incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [],
          planSettings: { ...basePlanSettings, planEndYear: 2027 },
          entities: [{ id: "ngt", name: "NGT", includeInPortfolio: false, isGrantor: false }],
        }),
      );
      const y = years[0];
      expect(y.accountLedgers["acct-trust-ira"].rmdAmount).toBeGreaterThan(0);
      expect(Object.keys(y.distributionDetail!.rmdCashByAccount)).toEqual(["acct-ira"]);
    });

    it("follows a split at death: each heir's share takes its own RMD, under its own name", () => {
      const years = runProjection(iraSplitAtFirstDeath());
      const shares = (years.find((y) => y.year === FIRST_DEATH_YEAR)!.deathTransfers ?? [])
        .filter((t) => t.sourceAccountId === "acct-401k")
        .map((t) => t.resultingAccountId);
      expect(shares).toHaveLength(2);
      for (const id of shares) expect(id).toMatch(/^death-acct-/);

      const survivorYears = years.filter((y) => y.year > FIRST_DEATH_YEAR);
      expect(survivorYears.length).toBeGreaterThan(0);
      for (const y of survivorYears) {
        const detail = y.distributionDetail!;
        // The split account is gone; both shares take their RMDs to household checking.
        expect(detail.rmdCashByAccount["acct-401k"]).toBeUndefined();
        for (const id of shares) {
          // Absent in a year the share owes nothing (Jane's own RMDs start at 75).
          expect(detail.rmdCashByAccount[id!] ?? 0, `${y.year} ${id}`).toBeCloseTo(
            y.accountLedgers[id!].rmdAmount,
            6,
          );
          expect(detail.mintedAccountNames[id!]).toMatch(/^John IRA — to /);
        }
        expect(sumOf(detail.rmdCashByAccount)).toBeCloseTo(detail.rmdInTotalIncome, 4);
      }
      expect(survivorYears.some((y) => shares.every((id) => (y.distributionDetail!.rmdCashByAccount[id!] ?? 0) > 0)))
        .toBe(true);
    });

    it("follows a trust beneficiary: the IRA keeps its id, but its RMD leaves the household", () => {
      const years = runProjection(iraToTrustAtFirstDeath());
      const survivorYears = years.filter((y) => y.year > FIRST_DEATH_YEAR);
      expect(survivorYears.some((y) => y.accountLedgers["acct-401k"]?.rmdAmount > 0)).toBe(true);
      for (const y of survivorYears) {
        expect(y.distributionDetail!.rmdCashByAccount["acct-401k"], `${y.year}`).toBeUndefined();
      }
    });
  });
});
