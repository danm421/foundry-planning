import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import {
  buildClientData,
  basePlanSettings,
  sampleAccounts,
  sampleIncomes,
} from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";
import type { Account, DisabilityPolicy, ProjectionYear } from "../types";

// The disability stress must behave like the person's paycheck genuinely stopped:
// no cash lands, nothing is taxed, and the resulting deficit is funded from the
// portfolio. Real client plans all have a default checking account, so these
// tests run the `hasChecking` cash-routing path (the legacy no-checking path is
// covered incidentally by the flat-mode fixtures elsewhere).
const checking: Account = {
  id: "acct-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 40000,
  basis: 40000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
};

const DISABILITY_YEAR = 2028;

function run(
  withDisability: boolean,
  policies: DisabilityPolicy[] = [],
): ProjectionYear[] {
  return runProjection(
    buildClientData({
      accounts: [...sampleAccounts, checking],
      disabilityPolicies: policies,
      planSettings: withDisability
        ? {
            ...basePlanSettings,
            disabilityEvent: { person: "client", startYear: DISABILITY_YEAR },
          }
        : basePlanSettings,
    }),
  );
}

function yearOf(rows: ProjectionYear[], year: number): ProjectionYear {
  const row = rows.find((r) => r.year === year);
  if (!row) throw new Error(`no projection row for ${year}`);
  return row;
}

/** Cash actually credited to household checking for one income row. */
function incomeCredited(row: ProjectionYear, incomeId: string): number {
  return (row.accountLedgers[checking.id]?.entries ?? [])
    .filter((e) => e.category === "income" && e.sourceId === incomeId)
    .reduce((sum, e) => sum + e.amount, 0);
}

/** Earned income the tax engine actually saw this year. */
function earnedIncomeTaxed(row: ProjectionYear): number {
  if (!row.taxDetail) throw new Error(`no taxDetail for ${row.year}`);
  return row.taxDetail.earnedIncome;
}

const CLIENT_SALARY = "inc-salary-john";
const SPOUSE_SALARY = "inc-salary-jane";

describe("disability stress — the disabled person's earned income truly stops", () => {
  const base = run(false);
  const stress = run(true);

  it("stops crediting the disabled person's salary to household cash", () => {
    const baseRow = yearOf(base, DISABILITY_YEAR);
    const stressRow = yearOf(stress, DISABILITY_YEAR);

    expect(incomeCredited(baseRow, CLIENT_SALARY)).toBeGreaterThan(0);
    expect(incomeCredited(stressRow, CLIENT_SALARY)).toBe(0);
  });

  it("keeps crediting the healthy spouse's salary", () => {
    const stressRow = yearOf(stress, DISABILITY_YEAR);
    expect(incomeCredited(stressRow, SPOUSE_SALARY)).toBeCloseTo(
      incomeCredited(yearOf(base, DISABILITY_YEAR), SPOUSE_SALARY),
      2,
    );
  });

  it("stops taxing the disabled person's salary", () => {
    const baseRow = yearOf(base, DISABILITY_YEAR);
    const stressRow = yearOf(stress, DISABILITY_YEAR);

    expect(earnedIncomeTaxed(stressRow)).toBeLessThan(earnedIncomeTaxed(baseRow));
    // Only the client's salary went away — the spouse's stays in the tax base.
    expect(earnedIncomeTaxed(baseRow) - earnedIncomeTaxed(stressRow))
      .toBeCloseTo(incomeCredited(baseRow, CLIENT_SALARY), 0);
  });

  it("funds the resulting shortfall from the portfolio", () => {
    const baseRow = yearOf(base, DISABILITY_YEAR);
    const stressRow = yearOf(stress, DISABILITY_YEAR);

    expect(baseRow.withdrawals.total).toBe(0);
    expect(stressRow.withdrawals.total).toBeGreaterThan(0);
  });

  it("leaves the household worse off, not better", () => {
    const baseEnd = yearOf(base, DISABILITY_YEAR + 5);
    const stressEnd = yearOf(stress, DISABILITY_YEAR + 5);
    expect(stressEnd.portfolioAssets.liquidTotal).toBeLessThan(
      baseEnd.portfolioAssets.liquidTotal,
    );
  });

  it("leaves years before the disability untouched", () => {
    const beforeBase = yearOf(base, DISABILITY_YEAR - 1);
    const beforeStress = yearOf(stress, DISABILITY_YEAR - 1);
    expect(beforeStress.totalIncome).toBeCloseTo(beforeBase.totalIncome, 2);
    expect(beforeStress.portfolioAssets.liquidTotal).toBeCloseTo(
      beforeBase.portfolioAssets.liquidTotal,
      2,
    );
  });

  it("is a no-op when no disability event is configured", () => {
    const rows = runProjection(
      buildClientData({ accounts: [...sampleAccounts, checking] }),
    );
    expect(yearOf(rows, DISABILITY_YEAR).totalIncome).toBeCloseTo(
      yearOf(base, DISABILITY_YEAR).totalIncome,
      2,
    );
  });

  it("stops a spouse-owned salary when the spouse is the disabled person", () => {
    const rows = runProjection(
      buildClientData({
        accounts: [...sampleAccounts, checking],
        planSettings: {
          ...basePlanSettings,
          disabilityEvent: { person: "spouse", startYear: DISABILITY_YEAR },
        },
      }),
    );
    const row = yearOf(rows, DISABILITY_YEAR);
    expect(incomeCredited(row, SPOUSE_SALARY)).toBe(0);
    expect(incomeCredited(row, CLIENT_SALARY)).toBeGreaterThan(0);
  });

  it("does not touch non-earned income of the disabled person", () => {
    // John's Social Security row is owned by the client but is not earned income.
    const ssId = sampleIncomes.find((i) => i.type === "social_security")!.id;
    const claimYear = 2037; // John turns 67 in 2037
    const baseRow = yearOf(base, claimYear);
    const stressRow = yearOf(stress, claimYear);
    expect(baseRow.income.bySource[ssId]).toBeGreaterThan(0);
    expect(stressRow.income.bySource[ssId]).toBeCloseTo(
      baseRow.income.bySource[ssId],
      2,
    );
  });
});

// ── Benefits paid under the stress test ──────────────────────────────────────
// Group LTD with a matching 13-week STD layer: the classic 7-day/90-day pairing
// that hands off from short term to long term with no gap.
const workPolicy: DisabilityPolicy = {
  id: "dp-work",
  name: "Group disability",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: 10_000,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer",
};

const BENEFIT_ID = `disability-benefit-${workPolicy.id}`;

/** The numbers a policy is supposed to move, year by year. */
function planSeries(rows: ProjectionYear[]) {
  return rows.map((r) => [
    r.year,
    r.totalIncome,
    r.expenses.taxes,
    r.portfolioAssets.liquidTotal,
  ]);
}

describe("disability benefits in the projection", () => {
  it("credits the benefit to household checking in the disability year", () => {
    const rows = run(true, [workPolicy]);
    // John's salary in 2028 is 150,000 × 1.03² = 159,135 — read BEFORE the
    // clip, because the policy insures the paycheck that is about to stop.
    // 60% of that is 7,956.75/mo; 11.802876 covered months land in 2028.
    const credited = incomeCredited(yearOf(rows, DISABILITY_YEAR), BENEFIT_ID);
    expect(credited).toBeCloseTo(93_912.52, 0);
  });

  it("pays nothing when the stress test is off, leaving the plan untouched", () => {
    const withPolicies = run(false, [workPolicy]);
    const without = run(false, []);
    // A policy on file must not change a plan where nobody is disabled.
    expect(planSeries(withPolicies)).toEqual(planSeries(without));
    expect(
      withPolicies.reduce((sum, r) => sum + incomeCredited(r, BENEFIT_ID), 0),
    ).toBe(0);
    // Control: the same series DOES move when the stress test is on, so the
    // equality above is a real comparison and not two empty/constant arrays.
    expect(planSeries(run(true, [workPolicy]))).not.toEqual(planSeries(without));
  });

  it("leaves the household materially better off than the same disability with no coverage", () => {
    const covered = run(true, [workPolicy]);
    const bare = run(true, []);
    const last = covered.length - 1;
    expect(covered[last].portfolioAssets.liquidTotal).toBeGreaterThan(
      bare[last].portfolioAssets.liquidTotal,
    );
  });

  it("puts an employer-paid benefit in the taxed base and an employee-paid one in the tax-exempt bucket", () => {
    const taxable = run(true, [workPolicy]);
    const taxFree = run(true, [{ ...workPolicy, benefitTaxable: false }]);
    const y = DISABILITY_YEAR;
    const taxableDetail = yearOf(taxable, y).taxDetail!;
    const taxFreeDetail = yearOf(taxFree, y).taxDetail!;

    expect(taxableDetail.bySource[BENEFIT_ID].type).toBe("ordinary_income");
    expect(taxFreeDetail.bySource[BENEFIT_ID].type).toBe("tax_exempt");
    // The whole benefit moves between the two buckets — nothing is dropped or
    // counted twice on the way.
    expect(taxableDetail.ordinaryIncome - taxFreeDetail.ordinaryIncome).toBeCloseTo(
      93_912.52,
      0,
    );
    expect(taxFreeDetail.taxExempt - taxableDetail.taxExempt).toBeCloseTo(93_912.52, 0);
  });
});
