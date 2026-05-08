// src/lib/__tests__/entity-ledger.test.ts
import { describe, it, expect } from "vitest";
import { getEntityLedger, type EntityLedgerContext } from "../entity-ledger";
import { computeEntityCashFlow, type EntityMetadata } from "@/engine/entity-cashflow";
import type { ProjectionYear } from "@/engine/types";

function makeYear(year: number): ProjectionYear {
  return {
    year,
    ages: { client: 60, spouse: 58 },
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
    hypotheticalEstateTax: { client: 0, spouse: 0, joint: 0 },
    charitableOutflows: 0,
    entityCashFlow: new Map(),
  } as unknown as ProjectionYear;
}

function buildBusinessFixture() {
  const year = makeYear(2026);
  year.accountLedgers["acct-biz"] = {
    beginningValue: 50_000,
    endingValue: 52_500,
    growth: 2_500,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    entries: [],
  };

  const entitiesById = new Map<string, EntityMetadata>([
    [
      "ent-biz",
      {
        id: "ent-biz",
        name: "Acme LLC",
        entityType: "llc",
        trustSubType: null,
        isGrantor: false,
        initialValue: 10_000,
        initialBasis: 10_000,
        valueGrowthRate: 0.05,
      },
    ],
  ]);

  const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
    ["acct-biz", { entityId: "ent-biz", percent: 1 }],
  ]);

  computeEntityCashFlow({
    years: [year],
    entitiesById,
    accountEntityOwners,
    giftsByEntityYear: new Map(),
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  });

  const ctx: EntityLedgerContext = {
    year,
    planStartYear: 2026,
    entitiesById,
    accountNamesById: new Map([["acct-biz", "Acme Brokerage"]]),
    accountEntityOwners,
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  };

  return { year, ctx };
}

describe("getEntityLedger", () => {
  it("section sums equal the matching EntityCashFlowRow fields (business)", () => {
    const { year, ctx } = buildBusinessFixture();
    const ledger = getEntityLedger("ent-biz", ctx);
    const row = year.entityCashFlow.get("ent-biz");
    expect(row?.kind).toBe("business");
    if (row?.kind !== "business") return;

    const sum = (rows: { amount: number }[]) =>
      rows.reduce((a, r) => a + r.amount, 0);

    expect(sum(ledger.growth)).toBeCloseTo(row.growth, 2);
    expect(sum(ledger.income)).toBeCloseTo(row.income, 2);
    expect(sum(ledger.expenses)).toBeCloseTo(row.expenses, 2);
    expect(sum(ledger.ending)).toBeCloseTo(row.endingTotalValue, 2);
  });

  it("growth section emits flat-business + per-account rows", () => {
    const { ctx } = buildBusinessFixture();
    const ledger = getEntityLedger("ent-biz", ctx);

    // Flat business growth at year 0: initialValue × ((1+g)^1 - (1+g)^0) = 10000 × 0.05 = 500
    const flat = ledger.growth.find((r) => r.sourceKind === "flat-business");
    expect(flat?.amount).toBeCloseTo(500, 2);
    expect(flat?.label).toContain("Acme LLC");

    // Account growth: 100% × $2,500
    const acct = ledger.growth.find((r) => r.sourceKind === "account");
    expect(acct?.amount).toBeCloseTo(2_500, 2);
    expect(acct?.label).toContain("Acme Brokerage");
  });
});
