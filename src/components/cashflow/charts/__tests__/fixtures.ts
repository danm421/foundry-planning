// src/components/cashflow/charts/__tests__/fixtures.ts
import type { ProjectionYear, ClientData } from "@/engine";

/** Minimal 3-year ProjectionYear fixture. Only fields the chart helpers read
 *  are populated — others are zero/empty. Add fields here as new chart helpers
 *  need them; keep the shape minimal so tests stay legible. */
export function makeYear(overrides: Partial<ProjectionYear> & { year: number }): ProjectionYear {
  return {
    ages: { client: 60 + (overrides.year - 2026), spouse: 58 + (overrides.year - 2026) },
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
    hypotheticalEstateTax: { single: 0 } as unknown as ProjectionYear["hypotheticalEstateTax"],
    ...overrides,
  } as ProjectionYear;
}

/** Three-year fixture with non-zero income across multiple sources. */
export const incomeFixture: ProjectionYear[] = [
  makeYear({
    year: 2026,
    income: {
      salaries: 100_000,
      socialSecurity: 0,
      business: 0,
      trust: 0,
      deferred: 0,
      capitalGains: 0,
      other: 5_000,
      total: 105_000,
      bySource: {},
    },
  }),
  makeYear({
    year: 2027,
    income: {
      salaries: 50_000,
      socialSecurity: 30_000,
      business: 0,
      trust: 0,
      deferred: 10_000,
      capitalGains: 0,
      other: 5_000,
      total: 95_000,
      bySource: {},
    },
  }),
  makeYear({
    year: 2028,
    income: {
      salaries: 0,
      socialSecurity: 35_000,
      business: 0,
      trust: 0,
      deferred: 15_000,
      capitalGains: 8_000,
      other: 0,
      total: 58_000,
      bySource: {},
    },
  }),
];

/** Stub ClientData — tests rarely need full data; pass partials and cast. */
export const stubClientData: ClientData = {
  client: { id: "c1", firstName: "Test", lastName: "Client", lifeExpectancy: 95 },
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  planSettings: { planStartYear: 2026, planEndYear: 2076 },
} as unknown as ClientData;
