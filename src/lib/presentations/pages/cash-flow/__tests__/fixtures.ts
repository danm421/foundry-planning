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
  rmdAmount = 0,
): AccountLedger {
  return {
    beginningValue: 0,
    growth: 0,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount,
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
        stockOptions: {},
        taxableTotal: 0,
        cashTotal: 0,
        retirementTotal: 0,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        stockOptionsTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 0,
        liquidTotal: 0,
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
      expenses: {
        living: 70_000, liabilities: 0, other: 0, insurance: 0,
        realEstate: 0, taxes: 0, cashGifts: 0, discretionary: 0,
        total: 70_000, bySource: {}, byLiability: {}, interestByLiability: {},
      },
      savings: { byAccount: {}, total: 50_000, employerTotal: 0 },
      totalIncome: 200_000,
      totalExpenses: 120_000,
      netCashFlow: 80_000,
      // Bucket values equal the ledgers' ending values, as the engine guarantees:
      // a bucket holds the owned share of an account, so growth and activity can
      // be weighted back to that share. A fixture where the two disagree implies
      // fractional ownership that the ledgers don't reflect.
      portfolioAssets: {
        taxable: { brokerage: 512_000 },
        cash: { checking: 100_000 },
        retirement: { ira: 758_000 },
        realEstate: {},
        business: {},
        lifeInsurance: {},
        stockOptions: {},
        taxableTotal: 512_000,
        cashTotal: 100_000,
        retirementTotal: 758_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        stockOptionsTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 1_370_000,
        liquidTotal: 1_370_000,
      },
      accountLedgers: {
        // Growth = 20k, contributions 50k (savings), no distributions
        brokerage: {
          beginningValue: 480_000, growth: 12_000, contributions: 20_000,
          distributions: 0, internalContributions: 0, internalDistributions: 0,
          rmdAmount: 0, fees: 0, endingValue: 512_000, entries: [],
        },
        ira: {
          beginningValue: 720_000, growth: 8_000, contributions: 30_000,
          distributions: 0, internalContributions: 0, internalDistributions: 0,
          rmdAmount: 0, fees: 0, endingValue: 758_000, entries: [],
        },
        checking: {
          beginningValue: 100_000, growth: 0, contributions: 0,
          distributions: 0, internalContributions: 0, internalDistributions: 0,
          rmdAmount: 0, fees: 0, endingValue: 100_000, entries: [],
        },
      },
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
      withdrawals: { byAccount: { ira: 40_000 }, total: 40_000 },
      expenses: {
        living: 130_000, liabilities: 0, other: 0, insurance: 0,
        realEstate: 0, taxes: 0, cashGifts: 0, discretionary: 0,
        total: 130_000, bySource: {}, byLiability: {}, interestByLiability: {},
      },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalIncome: 75_000,
      totalExpenses: 130_000,
      netCashFlow: -55_000,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: { ira: 920_000 },
        realEstate: {},
        business: {},
        lifeInsurance: {},
        stockOptions: {},
        taxableTotal: 400_000,
        cashTotal: 80_000,
        retirementTotal: 920_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        stockOptionsTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 1_400_000,
        liquidTotal: 1_400_000,
      },
      // Faithful to the engine: an RMD writes a `-rmd` distribution on the
      // source account (with `rmdAmount` set) AND a `+rmd` credit on checking.
      accountLedgers: {
        ira: makeLedger(
          [
            { category: "rmd", label: "RMD", amount: -40_000 },
            { category: "withdrawal", label: "Withdrawal", amount: -40_000 },
          ],
          40_000,
        ),
        checking: makeLedger([
          { category: "rmd", label: "RMD from ira", amount: 40_000 },
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
      withdrawals: { byAccount: { ira: 40_000 }, total: 40_000 },
      expenses: {
        living: 140_000, liabilities: 0, other: 0, insurance: 0,
        realEstate: 0, taxes: 0, cashGifts: 0, discretionary: 0,
        total: 140_000, bySource: {}, byLiability: {}, interestByLiability: {},
      },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalIncome: 100_000,
      totalExpenses: 140_000,
      netCashFlow: -40_000,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: { ira: 900_000 },
        realEstate: {},
        business: {},
        lifeInsurance: {},
        stockOptions: {},
        taxableTotal: 350_000,
        cashTotal: 60_000,
        retirementTotal: 900_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        stockOptionsTotal: 0,
        // Entity-owned (non-IIP trust) retirement account: appears in
        // trustsAndBusinesses, NOT in any of the six household buckets. Its
        // RMD must be excluded from the household RMD column (F81).
        trustsAndBusinesses: { trustIra: 300_000 },
        trustsAndBusinessesTotal: 300_000,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 1_310_000,
        liquidTotal: 1_310_000,
      },
      accountLedgers: {
        ira: makeLedger(
          [
            { category: "rmd", label: "RMD", amount: -60_000 },
            { category: "withdrawal", label: "Withdrawal", amount: -40_000 },
          ],
          60_000,
        ),
        checking: makeLedger([
          { category: "rmd", label: "RMD from ira", amount: 60_000 },
        ]),
        // Entity-owned retirement account: the engine sets `rmdAmount` on its
        // ledger (projection.ts:1404) for ALL rmd-enabled accounts, but the RMD
        // is routed to entity checking — NOT to householdRmdIncome/totalIncome.
        trustIra: makeLedger(
          [{ category: "rmd", label: "RMD from trustIra", amount: -25_000 }],
          25_000,
        ),
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
      withdrawals: { byAccount: {}, total: 0 },
      expenses: {
        living: 150_000, liabilities: 0, other: 0, insurance: 0,
        realEstate: 0, taxes: 0, cashGifts: 0, discretionary: 0,
        total: 150_000, bySource: {}, byLiability: {}, interestByLiability: {},
      },
      savings: { byAccount: {}, total: 0, employerTotal: 0 },
      totalIncome: 95_000,
      totalExpenses: 150_000,
      netCashFlow: -55_000,
      portfolioAssets: {
        taxable: {},
        cash: {},
        retirement: { ira: 450_000 },
        realEstate: {},
        business: {},
        lifeInsurance: {},
        stockOptions: {},
        taxableTotal: 200_000,
        cashTotal: 20_000,
        retirementTotal: 450_000,
        realEstateTotal: 0,
        businessTotal: 0,
        lifeInsuranceTotal: 0,
        stockOptionsTotal: 0,
        trustsAndBusinesses: {},
        trustsAndBusinessesTotal: 0,
        accessibleTrustAssets: {},
        accessibleTrustAssetsTotal: 0,
        total: 670_000,
        liquidTotal: 670_000,
      },
      accountLedgers: {
        ira: makeLedger(
          [{ category: "rmd", label: "RMD", amount: -50_000 }],
          50_000,
        ),
        checking: makeLedger([
          { category: "rmd", label: "RMD from ira", amount: 50_000 },
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
