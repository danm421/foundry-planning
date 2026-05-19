/**
 * Life-insurance payout visibility — the death benefit must surface as a
 * cash-flow inflow (ProjectionYear.income) and a portfolio asset in the
 * death year. Scenario: married couple, client dies first, term policy on
 * the client. See spec 2026-05-19-life-insurance-payout-visibility-design.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  ClientInfo,
  Expense,
  FamilyMember,
  LifeInsurancePolicy,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

const PLAN_START = 2026;
const PLAN_END = 2066;

// Client born 1960; lifeExpectancy drives the first-death year.
const CLIENT: ClientInfo = {
  firstName: "John",
  lastName: "Doe",
  dateOfBirth: "1960-01-01",
  retirementAge: 65,
  planEndAge: 100,
  filingStatus: "married_joint",
  lifeExpectancy: 70, // dies 2030
  spouseName: "Jane Doe",
  spouseDob: "1962-01-01",
  spouseRetirementAge: 65,
  spouseLifeExpectancy: 95, // dies ~2057
};

const PLAN: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  planStartYear: PLAN_START,
  planEndYear: PLAN_END,
  taxInflationRate: 0,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
};

const CLIENT_FM: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "John",
  lastName: "Doe",
  dateOfBirth: "1960-01-01",
};
const SPOUSE_FM: FamilyMember = {
  id: LEGACY_FM_SPOUSE,
  role: "spouse",
  relationship: "other",
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "1962-01-01",
};

function mkPolicy(opts: {
  withBeneficiary: boolean;
  insuredPerson: "client" | "spouse" | "joint";
}): Account {
  const policy: LifeInsurancePolicy = {
    faceValue: 1_000_000,
    costBasis: 0,
    premiumAmount: 0,
    premiumYears: null,
    policyType: "term",
    termIssueYear: 2026,
    termLengthYears: 40, // in-force well past every death year tested
    endsAtInsuredRetirement: false,
    cashValueGrowthMode: "basic",
    postPayoutGrowthRate: 0,
    cashValueSchedule: [],
  };
  return {
    id: "pol-1",
    name: "Term Life Policy",
    category: "life_insurance",
    subType: "term",
    insuredPerson: opts.insuredPerson,
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    lifeInsurance: policy,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...(opts.withBeneficiary
      ? {
          beneficiaries: [
            {
              id: "bref-spouse",
              tier: "primary" as const,
              percentage: 100,
              familyMemberId: LEGACY_FM_SPOUSE,
              sortOrder: 0,
            },
          ],
        }
      : {}),
  };
}

function mkData(opts: {
  withBeneficiary: boolean;
  insuredPerson?: "client" | "spouse" | "joint";
  clientLifeExpectancy?: number;
}): ClientData {
  return {
    client: { ...CLIENT, lifeExpectancy: opts.clientLifeExpectancy ?? 70 },
    accounts: [
      mkPolicy({
        withBeneficiary: opts.withBeneficiary,
        insuredPerson: opts.insuredPerson ?? "client",
      }),
    ],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: PLAN,
    familyMembers: [CLIENT_FM, SPOUSE_FM],
    giftEvents: [],
  };
}

describe("life-insurance payout — cash-flow inflow", () => {
  it("surfaces the face value in death-year income (spouse beneficiary)", () => {
    const years = runProjection(mkData({ withBeneficiary: true }));
    const death = years.find((y) => y.year === 2030)!;
    expect(death.income.other).toBe(1_000_000);
    expect(death.income.total).toBe(1_000_000);
    expect(death.totalIncome).toBe(1_000_000);
    expect(death.income.bySource["life-insurance-proceeds:pol-1"]).toBe(1_000_000);
    expect(death.netCashFlow).toBe(1_000_000);
  });

  it("surfaces the face value in death-year income (no beneficiary)", () => {
    const years = runProjection(mkData({ withBeneficiary: false }));
    const death = years.find((y) => y.year === 2030)!;
    expect(death.income.other).toBe(1_000_000);
    expect(death.income.bySource["life-insurance-proceeds:pol-1"]).toBe(1_000_000);
    expect(death.income.total).toBe(1_000_000);
    expect(death.totalIncome).toBe(1_000_000);
    expect(death.netCashFlow).toBe(1_000_000);
  });

  it("does not add income in non-death years", () => {
    const years = runProjection(mkData({ withBeneficiary: true }));
    const before = years.find((y) => y.year === 2029)!;
    const after = years.find((y) => y.year === 2031)!;
    expect(before.income.bySource["life-insurance-proceeds:pol-1"]).toBeUndefined();
    expect(after.income.bySource["life-insurance-proceeds:pol-1"]).toBeUndefined();
  });

  it("surfaces a joint-insured payout at final death", () => {
    const years = runProjection(
      mkData({ withBeneficiary: false, insuredPerson: "joint" }),
    );
    // Joint policy fires at final death — spouse dies 2057.
    const finalYear = years[years.length - 1];
    expect(finalYear.income.bySource["life-insurance-proceeds:pol-1"]).toBe(
      1_000_000,
    );
  });

  it("handles a premature death (life expectancy below 70)", () => {
    // Client born 1960, lifeExpectancy 67 -> dies 2027 (PLAN_START + 1).
    const years = runProjection(
      mkData({ withBeneficiary: true, clientLifeExpectancy: 67 }),
    );
    const death = years.find((y) => y.year === 2027)!;
    expect(death).toBeDefined();
    expect(death.income.bySource["life-insurance-proceeds:pol-1"]).toBe(
      1_000_000,
    );
  });
});

describe("life-insurance payout — portfolio asset", () => {
  it("shows the face value as a taxable asset in the death year itself", () => {
    const years = runProjection(mkData({ withBeneficiary: true }));
    const death = years.find((y) => y.year === 2030)!;
    expect(death.portfolioAssets.taxable["pol-1"]).toBe(1_000_000);
    expect(death.portfolioAssets.taxableTotal).toBe(1_000_000);
  });

  it("keeps the proceeds visible the year after death", () => {
    const years = runProjection(mkData({ withBeneficiary: true }));
    const after = years.find((y) => y.year === 2031)!;
    expect(after.portfolioAssets.taxableTotal).toBe(1_000_000);
  });
});

describe("life-insurance proceeds — liquidation order", () => {
  // Client dies 2030. A $1M term policy on the client pays out; a $2M IRA is
  // owned by the surviving spouse. Post-death living expenses force annual
  // supplemental withdrawals. The proceeds (taxable) must liquidate before the
  // retirement account.
  function mkLiquidationData(): ClientData {
    const policy = mkPolicy({ withBeneficiary: true, insuredPerson: "client" });
    const ira: Account = {
      id: "ret-1",
      name: "Traditional IRA",
      category: "retirement",
      subType: "traditional_ira",
      value: 2_000_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
    };
    const livingExpense: Expense = {
      id: "exp-1",
      type: "living",
      name: "Living expenses",
      annualAmount: 150_000,
      startYear: 2031,
      endYear: 2060,
      growthRate: 0,
    };
    return {
      client: { ...CLIENT, lifeExpectancy: 70 },
      accounts: [policy, ira],
      incomes: [],
      expenses: [livingExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: PLAN,
      familyMembers: [CLIENT_FM, SPOUSE_FM],
      giftEvents: [],
    };
  }

  it("draws life-insurance proceeds before retirement assets", () => {
    const years = runProjection(mkLiquidationData());
    // 2033 — three years post-death. The $1M proceeds still cover the
    // $150k/yr shortfall, so the IRA must be completely untouched.
    const y2033 = years.find((y) => y.year === 2033)!;
    expect(y2033.portfolioAssets.retirementTotal).toBe(2_000_000);
    expect(y2033.portfolioAssets.taxableTotal).toBeGreaterThan(0);
    expect(y2033.portfolioAssets.taxableTotal).toBeLessThan(1_000_000);
  });

  it("falls through to retirement once proceeds are exhausted", () => {
    const years = runProjection(mkLiquidationData());
    // 2045 — proceeds ($1M / $150k ≈ 7 yrs) are long gone; the IRA is drawn.
    const y2045 = years.find((y) => y.year === 2045)!;
    expect(y2045.portfolioAssets.taxableTotal).toBe(0);
    expect(y2045.portfolioAssets.retirementTotal).toBeLessThan(2_000_000);
  });
});
