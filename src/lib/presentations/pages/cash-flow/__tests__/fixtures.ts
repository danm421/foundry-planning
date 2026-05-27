// Test fixtures for the cash-flow view-model.
// All numbers are hand-crafted to match the plan's happy-path assertions.

import type {
  ClientData,
  ClientInfo,
  ProjectionYear,
  AccountLedger,
  PlanSettings,
} from "@/engine/types";

// ── AccountLedger helper ─────────────────────────────────────────────────────

function makeLedger(
  entries: AccountLedger["entries"],
): AccountLedger {
  return {
    beginningValue: 0,
    growth: 0,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    endingValue: 0,
    entries,
  };
}

// ── ProjectionYear factory ───────────────────────────────────────────────────

export function makeProjectionYears(): ProjectionYear[] {
  // Cast via unknown — ProjectionYear has many required fields (e.g.
  // hypotheticalEstateTax, entityCashFlow) that the view-model never reads.
  // We only populate the fields the view-model actually consumes.
  const baseYear = (overrides: Partial<ProjectionYear>): ProjectionYear =>
    ({
      year: 0,
      ages: { client: 0 },
      income: {
        salaries: 0,
        socialSecurity: 0,
        business: 0,
        trust: 0,
        deferred: 0,
        capitalGains: 0,
        other: 0,
        total: 0,
        bySource: {},
      },
      withdrawals: { byAccount: {}, total: 0 },
      entityWithdrawals: { byAccount: {}, total: 0 },
      expenses: {
        living: 0,
        liabilities: 0,
        other: 0,
        insurance: 0,
        realEstate: 0,
        taxes: 0,
        cashGifts: 0,
        discretionary: 0,
        total: 0,
        bySource: {},
        byLiability: {},
        interestByLiability: {},
      },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalIncome: 0,
      totalExpenses: 0,
      netCashFlow: 0,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: {},
        realEstate: {},
        business: {},
        lifeInsurance: {},
        taxableTotal: 0,
        cashTotal: 0,
        retirementTotal: 0,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 0,
      },
      accountLedgers: {},
      accountBasisBoY: {},
      liabilityBalancesBoY: {},
      ...overrides,
    }) as unknown as ProjectionYear;

  return [
    // 2026 — pre-retirement (Cooper 60, Susan 56)
    baseYear({
      year: 2026,
      ages: { client: 60, spouse: 56 },
      income: {
        salaries: 200_000,
        socialSecurity: 0,
        business: 0,
        trust: 0,
        deferred: 0,
        capitalGains: 0,
        other: 0,
        total: 200_000,
        bySource: {},
      },
      savings: { byAccount: {}, total: 50_000, employerTotal: 0 },
      totalExpenses: 120_000,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: {},
        realEstate: {},
        business: {},
        lifeInsurance: {},
        taxableTotal: 500_000,
        cashTotal: 100_000,
        retirementTotal: 750_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 1_350_000,
      },
      accountLedgers: {},
    }),

    // 2031 — retirement year (Cooper 65, Susan 61)
    baseYear({
      year: 2031,
      ages: { client: 65, spouse: 61 },
      income: {
        salaries: 0,
        socialSecurity: 30_000,
        business: 5_000,
        trust: 0,
        deferred: 0,
        capitalGains: 0,
        other: 0,
        total: 35_000,
        bySource: {},
      },
      withdrawals: { byAccount: {}, total: 80_000 },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalExpenses: 130_000,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: {},
        realEstate: {},
        business: {},
        lifeInsurance: {},
        taxableTotal: 400_000,
        cashTotal: 80_000,
        retirementTotal: 920_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 1_400_000,
      },
      accountLedgers: {
        ira: makeLedger([
          { category: "rmd", label: "RMD", amount: -40_000 },
          { category: "withdrawal", label: "Withdrawal", amount: -40_000 },
        ]),
      },
    }),

    // 2036 — mid-retirement (Cooper 70, Susan 66)
    baseYear({
      year: 2036,
      ages: { client: 70, spouse: 66 },
      income: {
        salaries: 0,
        socialSecurity: 33_000,
        business: 5_000,
        trust: 0,
        deferred: 0,
        capitalGains: 2_000,
        other: 0,
        total: 40_000,
        bySource: {},
      },
      withdrawals: { byAccount: {}, total: 100_000 },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalExpenses: 140_000,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: {},
        realEstate: {},
        business: {},
        lifeInsurance: {},
        taxableTotal: 350_000,
        cashTotal: 60_000,
        retirementTotal: 900_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 1_310_000,
      },
      accountLedgers: {
        ira: makeLedger([
          { category: "rmd", label: "RMD", amount: -60_000 },
          { category: "withdrawal", label: "Withdrawal", amount: -40_000 },
        ]),
      },
    }),

    // 2071 — end-of-life (Cooper 105 but plan end 100, Susan 101 but life expectancy 96)
    // Using ages that reflect the fixture dob + year: client=105, spouse=101
    // but the fixture asserts ages as per engine output
    baseYear({
      year: 2071,
      ages: { client: 105, spouse: 101 },
      income: {
        salaries: 0,
        socialSecurity: 40_000,
        business: 5_000,
        trust: 0,
        deferred: 0,
        capitalGains: 0,
        other: 0,
        total: 45_000,
        bySource: {},
      },
      withdrawals: { byAccount: {}, total: 50_000 },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalExpenses: 150_000,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: {},
        realEstate: {},
        business: {},
        lifeInsurance: {},
        taxableTotal: 200_000,
        cashTotal: 20_000,
        retirementTotal: 450_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 670_000,
      },
      accountLedgers: {
        ira: makeLedger([
          { category: "rmd", label: "RMD", amount: -50_000 },
        ]),
      },
    }),
  ];
}

// ── ClientData factory ───────────────────────────────────────────────────────

export function makeClientData(): ClientData {
  const client: ClientInfo = {
    firstName: "Cooper",
    lastName: "Sample",
    dateOfBirth: "1966-01-01",
    retirementAge: 65,
    planEndAge: 100,
    lifeExpectancy: 100,
    spouseName: "Susan",
    spouseDob: "1970-01-01",
    spouseRetirementAge: 61,
    spouseLifeExpectancy: 99,
    filingStatus: "married_joint",
  };

  return {
    client,
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    giftEvents: [],
    planSettings: {} as PlanSettings,
  };
}
