// src/engine/__tests__/entity-cashflow.test.ts
import { describe, it, expect } from "vitest";
import { computeEntityCashFlow } from "../entity-cashflow";
import type { ProjectionYear } from "../types";

function makeYear(year: number): ProjectionYear {
  // Minimal-shape ProjectionYear for unit testing the cashflow pass.
  // Most fields are unused by computeEntityCashFlow; safe to default.
  return {
    year,
    ages: { client: 60 + (year - 2026), spouse: 58 + (year - 2026) },
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
    expenses: {
      living: 0,
      liabilities: 0,
      other: 0,
      insurance: 0,
      realEstate: 0,
      taxes: 0,
      total: 0,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
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
    hypotheticalEstateTax: { client: 0, spouse: 0, joint: 0 } as never, // shape stub
    charitableOutflows: 0,
    entityCashFlow: new Map(),
  } as unknown as ProjectionYear;
}

describe("computeEntityCashFlow", () => {
  it("populates an empty map when there are no entities", () => {
    const years = [makeYear(2026), makeYear(2027)];
    computeEntityCashFlow({
      years,
      entitiesById: new Map(),
      accountEntityOwners: new Map(),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
    });
    expect(years[0].entityCashFlow.size).toBe(0);
    expect(years[1].entityCashFlow.size).toBe(0);
  });
});
