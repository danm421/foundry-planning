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

  it("computes trust BoY/EoY balance from entity-owned account ledgers", () => {
    const trust = {
      id: "trust-1",
      name: "Smith SLAT",
      entityType: "trust" as const,
      trustSubType: "slat" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "acc-1": {
        beginningValue: 100_000,
        endingValue: 105_000,
        growth: 5_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      },
      "acc-2": {
        beginningValue: 50_000,
        endingValue: 53_000,
        growth: 3_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      },
      "acc-3": {
        beginningValue: 200_000,
        endingValue: 210_000,
        growth: 10_000,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [],
      }, // household-owned, must NOT count
    };
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["trust-1", trust]]),
      accountEntityOwners: new Map([
        ["acc-1", { entityId: "trust-1", percent: 1 }],
        ["acc-2", { entityId: "trust-1", percent: 1 }],
      ]),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
    });
    const row = y.entityCashFlow.get("trust-1");
    expect(row?.kind).toBe("trust");
    expect(row && row.kind === "trust" && row.beginningBalance).toBe(150_000);
    expect(row && row.kind === "trust" && row.endingBalance).toBe(158_000);
    expect(row && row.kind === "trust" && row.growth).toBe(8_000);
  });

  it("populates trust income, expenses, and totalDistributions", () => {
    const trust = {
      id: "trust-1",
      name: "Smith SLAT",
      entityType: "trust" as const,
      trustSubType: "slat" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    y.accountLedgers = {
      "trust-cash": {
        beginningValue: 0,
        endingValue: 0,
        growth: 0,
        contributions: 75_000,
        distributions: 60_000,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        entries: [
          { category: "income", label: "Rental", amount: 75_000, sourceId: "inc-rental" },
          { category: "expense", label: "Management fees", amount: -10_000, sourceId: "exp-mgmt" },
        ],
      },
    };
    y.trustDistributionsByEntity = new Map([["trust-1", 50_000]]);
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["trust-1", trust]]),
      accountEntityOwners: new Map([["trust-cash", { entityId: "trust-1", percent: 1 }]]),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
    });
    const row = y.entityCashFlow.get("trust-1")!;
    expect(row.kind).toBe("trust");
    expect((row as { kind: "trust"; income: number }).income).toBe(75_000);
    expect((row as { kind: "trust"; expenses: number }).expenses).toBe(10_000);
    expect((row as { kind: "trust"; totalDistributions: number }).totalDistributions).toBe(50_000);
  });

  it("populates Transfers In from gifts and death-event bequests", () => {
    const trust = {
      id: "trust-1",
      name: "Smith SLAT",
      entityType: "trust" as const,
      trustSubType: "slat" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y2026 = makeYear(2026);
    const y2027 = makeYear(2027);
    // DeathTransfer uses recipientKind: "entity" + recipientId for entity recipients.
    y2027.deathTransfers = [
      {
        year: 2027,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: "acc-x",
        sourceAccountName: "Joint Brokerage",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        via: "will",
        recipientKind: "entity",
        recipientId: "trust-1",
        recipientLabel: "Smith SLAT",
        amount: 250_000,
        basis: 100_000,
        resultingAccountId: null,
        resultingLiabilityId: null,
      } as never,
      // A non-entity transfer in the same year must NOT count.
      {
        year: 2027,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: "acc-y",
        sourceAccountName: "IRA",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        via: "beneficiary_designation",
        recipientKind: "spouse",
        recipientId: null,
        recipientLabel: "Spouse",
        amount: 999_999,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId: null,
      } as never,
      // An entity transfer to a different entity must NOT count.
      {
        year: 2027,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: "acc-z",
        sourceAccountName: "Other",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        via: "will",
        recipientKind: "entity",
        recipientId: "trust-other",
        recipientLabel: "Other Trust",
        amount: 999_999,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId: null,
      } as never,
    ];
    computeEntityCashFlow({
      years: [y2026, y2027],
      entitiesById: new Map([["trust-1", trust]]),
      accountEntityOwners: new Map(),
      giftsByEntityYear: new Map([["trust-1", new Map([[2026, 100_000]])]]),
      incomes: [],
      expenses: [],
    });
    const row2026 = y2026.entityCashFlow.get("trust-1")!;
    const row2027 = y2027.entityCashFlow.get("trust-1")!;
    expect((row2026 as { kind: "trust"; transfersIn: number }).transfersIn).toBe(100_000);
    expect((row2027 as { kind: "trust"; transfersIn: number }).transfersIn).toBe(250_000);
  });

  it("includes charitable outflows and termination payouts in totalDistributions", () => {
    const trust = {
      id: "clut-1",
      name: "Smith CLUT",
      entityType: "trust" as const,
      trustSubType: "clut" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2030);
    y.accountLedgers = {};
    y.charitableOutflowDetail = [
      {
        kind: "clut_unitrust",
        trustId: "clut-1",
        trustName: "Smith CLUT",
        charityId: "char-1",
        amount: 25_000,
      } as never,
    ];
    y.trustTerminations = [
      {
        trustId: "clut-1",
        trustName: "Smith CLUT",
        totalDistributed: 500_000,
        toBeneficiaries: [],
      } as never,
    ];
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["clut-1", trust]]),
      accountEntityOwners: new Map(),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
    });
    const row = y.entityCashFlow.get("clut-1")!;
    expect((row as { kind: "trust"; totalDistributions: number }).totalDistributions).toBe(525_000);
  });
});
