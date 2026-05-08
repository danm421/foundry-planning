// src/engine/__tests__/entity-cashflow.test.ts
import { describe, it, expect } from "vitest";
import { computeEntityCashFlow } from "../entity-cashflow";
import type { ProjectionYear, Income, Expense } from "../types";

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
      entityFlowOverrides: [],
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
      entityFlowOverrides: [],
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
      entityFlowOverrides: [],
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
      entityFlowOverrides: [],
    });
    const row2026 = y2026.entityCashFlow.get("trust-1")!;
    const row2027 = y2027.entityCashFlow.get("trust-1")!;
    expect((row2026 as { kind: "trust"; transfersIn: number }).transfersIn).toBe(100_000);
    expect((row2027 as { kind: "trust"; transfersIn: number }).transfersIn).toBe(250_000);
  });

  it("populates trust Taxes from trustTaxByEntity for non-grantor; zero for grantor", () => {
    const nongrantor = {
      id: "ng-1",
      name: "Non-Grantor",
      entityType: "trust" as const,
      trustSubType: "irrevocable" as const,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
    };
    const grantor = {
      id: "g-1",
      name: "Grantor",
      entityType: "trust" as const,
      trustSubType: "revocable" as const,
      isGrantor: true,
      initialValue: 0,
      initialBasis: 0,
    };
    const y = makeYear(2026);
    // TrustTaxBreakdown total field is `total`, not `totalTax`.
    y.trustTaxByEntity = new Map([
      ["ng-1", { total: 12_000 } as never],
      ["g-1", { total: 9_000 } as never],
    ]);
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([
        ["ng-1", nongrantor],
        ["g-1", grantor],
      ]),
      accountEntityOwners: new Map(),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const ng = y.entityCashFlow.get("ng-1")!;
    const g = y.entityCashFlow.get("g-1")!;
    expect((ng as { kind: "trust"; taxes: number }).taxes).toBe(12_000);
    expect((g as { kind: "trust"; taxes: number }).taxes).toBe(0);
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
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("clut-1")!;
    expect((row as { kind: "trust"; totalDistributions: number }).totalDistributions).toBe(525_000);
  });

  it("computes business row: flat value + basis + growth + income/expenses + distribution + retained + EoY", () => {
    const llc = { id: "llc-1", name: "Smith Holdings", entityType: "llc" as const, trustSubType: null, isGrantor: false, initialValue: 50_000_000, initialBasis: 1_000_000 };
    const y = makeYear(2026);
    // The engine wrote the entity_distribution debit + household credit during
    // the projection. The report reads the debit on the entity's checking.
    y.accountLedgers = {
      "biz-cash": { beginningValue: 0, endingValue: 0, growth: 0, contributions: 10_000_000, distributions: 5_800_000, internalContributions: 0, internalDistributions: 0, rmdAmount: 0, fees: 0, entries: [
        { category: "income",              label: "Income: Operating",                  amount:  10_000_000, sourceId: "biz-inc" },
        { category: "expense",             label: "Expense: Operating",                 amount:  -4_200_000, sourceId: "biz-exp" },
        { category: "entity_distribution", label: "Distribution from Smith Holdings",   amount:  -5_800_000, sourceId: "llc-1"   },
      ] },
    };
    const incomes: Income[] = [
      { id: "biz-inc", type: "business", name: "Operating", annualAmount: 10_000_000, startYear: 2026, endYear: 2055, growthRate: 0, owner: "joint", ownerEntityId: "llc-1" } as never,
    ];
    const expenses: Expense[] = [
      { id: "biz-exp", type: "other", name: "Operating", annualAmount: 4_200_000, startYear: 2026, endYear: 2055, growthRate: 0, ownerEntityId: "llc-1" } as never,
    ];
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["llc-1", llc]]),
      accountEntityOwners: new Map([["biz-cash", { entityId: "llc-1", percent: 1 }]]),
      giftsByEntityYear: new Map(),
      incomes,
      expenses,
      entityFlowOverrides: [],
    });
    const row = y.entityCashFlow.get("llc-1")!;
    expect(row.kind).toBe("business");
    if (row.kind !== "business") return;
    expect(row.beginningTotalValue).toBe(50_000_000);   // entities.value (no entity-owned BoY balance on biz-cash)
    expect(row.beginningBasis).toBe(1_000_000);
    expect(row.growth).toBe(0);                          // 0 flat-value growth + 0 from cash account
    expect(row.income).toBe(10_000_000);
    expect(row.expenses).toBe(4_200_000);
    expect(row.annualDistribution).toBe(5_800_000);
    expect(row.retainedEarnings).toBe(0);                // (10M − 4.2M) − 5.8M
    expect(row.endingTotalValue).toBe(50_000_000);       // BoY + 0 growth + 0 retained
    expect(row.endingBasis).toBe(1_000_000);
  });
});
