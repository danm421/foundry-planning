// src/engine/__tests__/entity-cashflow.test.ts
import { describe, it, expect } from "vitest";
import { computeEntityCashFlow, type EntityMetadata } from "../entity-cashflow";
import { runProjection } from "../projection";
import type {
  ProjectionYear,
  Income,
  Expense,
  ClientData,
  Account,
  PlanSettings,
  FamilyMember,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

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
      cashGifts: 0,
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
      entitiesById: new Map<string, EntityMetadata>([
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

  it("compounds business flat value at valueGrowthRate starting in year 1", () => {
    const llc = {
      id: "llc-1",
      name: "Smith Holdings",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 1_000_000,
      initialBasis: 0,
      valueGrowthRate: 0.05,
    };
    const years = [makeYear(2026), makeYear(2027), makeYear(2028)];
    computeEntityCashFlow({
      years,
      entitiesById: new Map([["llc-1", llc]]),
      accountEntityOwners: new Map(),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });

    const r0 = years[0].entityCashFlow.get("llc-1")!;
    const r1 = years[1].entityCashFlow.get("llc-1")!;
    const r2 = years[2].entityCashFlow.get("llc-1")!;
    if (r0.kind !== "business" || r1.kind !== "business" || r2.kind !== "business") {
      throw new Error("expected business rows");
    }

    // Year 1 (planStart): BoY = initialValue, grows by 5% during the year.
    expect(r0.beginningTotalValue).toBe(1_000_000);
    expect(r0.growth).toBeCloseTo(50_000, 6);
    expect(r0.endingTotalValue).toBeCloseTo(1_050_000, 6);

    // Year 2: BoY matches Y1 ending; grows by 1,050,000 * 5% = 52,500.
    expect(r1.beginningTotalValue).toBeCloseTo(1_050_000, 6);
    expect(r1.growth).toBeCloseTo(52_500, 6);
    expect(r1.endingTotalValue).toBeCloseTo(1_102_500, 6);

    // Year 3: BoY matches Y2 ending; grows by 1,102,500 * 5% = 55,125.
    expect(r2.beginningTotalValue).toBeCloseTo(1_102_500, 6);
    expect(r2.growth).toBeCloseTo(55_125, 6);
    expect(r2.endingTotalValue).toBeCloseTo(1_157_625, 6);
  });

  it("schedule mode: business income/expense come from override scalars even without base rows", () => {
    const llc = {
      id: "llc-1",
      name: "Schedule LLC",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 0,
      initialBasis: 0,
      flowMode: "schedule" as const,
    };
    const y = makeYear(2026);
    computeEntityCashFlow({
      years: [y],
      entitiesById: new Map([["llc-1", llc]]),
      accountEntityOwners: new Map(),
      giftsByEntityYear: new Map(),
      // No base rows — schedule grid is the source of truth.
      incomes: [],
      expenses: [],
      entityFlowOverrides: [
        { entityId: "llc-1", year: 2026, incomeAmount: 10_000, expenseAmount: 1_000, distributionPercent: 1 },
      ],
    });
    const row = y.entityCashFlow.get("llc-1")!;
    if (row.kind !== "business") throw new Error("expected business row");
    expect(row.income).toBe(10_000);
    expect(row.expenses).toBe(1_000);
  });

  it("treats null valueGrowthRate as 0 — flat value stays constant year over year", () => {
    const llc = {
      id: "llc-1",
      name: "Static Co",
      entityType: "llc" as const,
      trustSubType: null,
      isGrantor: false,
      initialValue: 750_000,
      initialBasis: 0,
      valueGrowthRate: null,
    };
    const years = [makeYear(2026), makeYear(2027), makeYear(2028)];
    computeEntityCashFlow({
      years,
      entitiesById: new Map([["llc-1", llc]]),
      accountEntityOwners: new Map(),
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    for (const y of years) {
      const row = y.entityCashFlow.get("llc-1")!;
      if (row.kind !== "business") throw new Error("expected business row");
      expect(row.beginningTotalValue).toBe(750_000);
      expect(row.growth).toBe(0);
      expect(row.endingTotalValue).toBe(750_000);
    }
  });

  it("locks the entity share on split-owned accounts so household drains don't bleed into it", () => {
    const year = makeYear(2026);
    year.accountLedgers["acct-split"] = {
      beginningValue: 100_000,
      endingValue: 80_000, // household drained $20k from the account
      growth: 0,
      contributions: 0,
      distributions: 20_000,
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
          initialValue: 0,
          initialBasis: 0,
          valueGrowthRate: 0,
        },
      ],
    ]);

    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
      ["acct-split", { entityId: "ent-biz", percent: 0.2 }],
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

    const row = year.entityCashFlow.get("ent-biz");
    if (row?.kind !== "business") throw new Error("expected business row");
    expect(row.beginningTotalValue).toBeCloseTo(20_000, 2); // locked at 20% × $100k BoY
    expect(row.growth).toBeCloseTo(0, 2);
    // No retained earnings (no income/expenses), so EoY = BoY + growth = $20k
    // (NOT 20% × $80k = $16k as a naive proportional rollup would give)
    expect(row.endingTotalValue).toBeCloseTo(20_000, 2);
  });

  it("carries the locked entity share across years on split-owned accounts", () => {
    const y1 = makeYear(2026);
    y1.accountLedgers["acct-split"] = {
      beginningValue: 100_000,
      endingValue: 90_000, // year 1 household drain $10k
      growth: 0,
      contributions: 0,
      distributions: 10_000,
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      entries: [],
    };
    const y2 = makeYear(2027);
    y2.accountLedgers["acct-split"] = {
      beginningValue: 90_000, // carries from y1 EoY
      endingValue: 85_000, // year 2 drain $5k
      growth: 0,
      contributions: 0,
      distributions: 5_000,
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
          initialValue: 0,
          initialBasis: 0,
          valueGrowthRate: 0,
        },
      ],
    ]);

    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
      ["acct-split", { entityId: "ent-biz", percent: 0.2 }],
    ]);

    computeEntityCashFlow({
      years: [y1, y2],
      entitiesById,
      accountEntityOwners,
      giftsByEntityYear: new Map(),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });

    const r1 = y1.entityCashFlow.get("ent-biz");
    if (r1?.kind !== "business") throw new Error("expected business row y1");
    expect(r1.beginningTotalValue).toBeCloseTo(20_000, 2);
    expect(r1.endingTotalValue).toBeCloseTo(20_000, 2);

    const r2 = y2.entityCashFlow.get("ent-biz");
    if (r2?.kind !== "business") throw new Error("expected business row y2");
    expect(r2.beginningTotalValue).toBeCloseTo(20_000, 2); // carried, not 20% × $90k = $18k
    expect(r2.endingTotalValue).toBeCloseTo(20_000, 2);
  });

  it("rolls in account values proportionally for split entity/personal ownership", () => {
    const year = makeYear(2026);
    year.accountLedgers["acct-split"] = {
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
          initialValue: 0,
          initialBasis: 0,
          valueGrowthRate: 0,
        },
      ],
    ]);

    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
      ["acct-split", { entityId: "ent-biz", percent: 0.6 }],
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

    const row = year.entityCashFlow.get("ent-biz");
    expect(row?.kind).toBe("business");
    if (row?.kind !== "business") return;
    expect(row.beginningTotalValue).toBeCloseTo(60_000, 2);
    expect(row.growth).toBeCloseTo(3_000, 2);
    expect(row.endingTotalValue).toBeCloseTo(63_000, 2);
  });
});

// ── Integration: runProjection wires computeEntityCashFlow ──────────────────

describe("computeEntityCashFlow integration via runProjection", () => {
  // Minimal fixture mirroring projection.trust-distributions-surface.test.ts.
  // Goal: verify wiring — `entityCashFlow` is a populated Map on every year,
  // regardless of whether the household has any entities. The unit tests above
  // already cover the row-content logic.
  const planSettings: PlanSettings = {
    flatFederalRate: 0.24,
    flatStateRate: 0.05,
    inflationRate: 0.03,
    planStartYear: 2026,
    planEndYear: 2027,
  };
  const client = {
    firstName: "Alice",
    lastName: "Test",
    dateOfBirth: "1975-01-01",
    retirementAge: 65,
    planEndAge: 90,
    filingStatus: "married_joint" as const,
    spouseName: "Bob Test",
    spouseDob: "1975-06-01",
    spouseRetirementAge: 65,
  };
  const hhChecking: Account = {
    id: "hh-checking",
    name: "Household Checking",
    category: "cash",
    subType: "checking",
    value: 100_000,
    basis: 100_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
    isDefaultChecking: true,
  };
  const spouseFm: FamilyMember = {
    id: "fm-spouse",
    relationship: "other",
    role: "other",
    firstName: "Bob",
    lastName: "Test",
    dateOfBirth: "1975-06-01",
  };
  const TRUST_INCOME_2026 = [
    { from: 0,     to: 3300,  rate: 0.10 },
    { from: 3300,  to: 12000, rate: 0.24 },
    { from: 12000, to: 16250, rate: 0.35 },
    { from: 16250, to: null,  rate: 0.37 },
  ];
  const TRUST_CAP_GAINS_2026 = [
    { from: 0,     to: 3350,  rate: 0    },
    { from: 3350,  to: 16300, rate: 0.15 },
    { from: 16300, to: null,  rate: 0.20 },
  ];
  const taxYearRow: TaxYearParameters = {
    year: 2026,
    incomeBrackets: {
      married_joint:    [{ from: 0, to: null, rate: 0.10 }],
      single:           [{ from: 0, to: null, rate: 0.10 }],
      head_of_household:[{ from: 0, to: null, rate: 0.10 }],
      married_separate: [{ from: 0, to: null, rate: 0.10 }],
    },
    capGainsBrackets: {
      married_joint:    { zeroPctTop: 94050, fifteenPctTop: 583750 },
      single:           { zeroPctTop: 47025, fifteenPctTop: 518900 },
      head_of_household:{ zeroPctTop: 63000, fifteenPctTop: 551350 },
      married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
    },
    trustIncomeBrackets: TRUST_INCOME_2026,
    trustCapGainsBrackets: TRUST_CAP_GAINS_2026,
    stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
    amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
    amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
    amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
    ssTaxRate: 0.062,
    ssWageBase: 176100,
    medicareTaxRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038,
    niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: {
      thresholdMfj: 383900,
      thresholdSingleHohMfs: 191950,
      phaseInRangeMfj: 100000,
      phaseInRangeOther: 50000,
    },
    contribLimits: {
      ira401kElective: 23500,
      ira401kCatchup50: 7500,
      ira401kCatchup6063: 11250,
      iraTradLimit: 7000,
      iraCatchup50: 1000,
      simpleLimitRegular: 17000,
      simpleCatchup50: 4000,
      hsaLimitSelf: 4400,
      hsaLimitFamily: 8750,
      hsaCatchup55: 1000,
    },
  };

  it("populates entityCashFlow on every projection year (no entities)", () => {
    const data: ClientData = {
      client,
      accounts: [hhChecking],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };
    const years = runProjection(data);
    expect(years).toHaveLength(2);
    for (const y of years) {
      expect(y.entityCashFlow).toBeInstanceOf(Map);
      // No entities → empty map, but the field must still exist.
      expect(y.entityCashFlow.size).toBe(0);
    }
  });
});
