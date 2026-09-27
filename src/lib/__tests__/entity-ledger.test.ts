// src/lib/__tests__/entity-ledger.test.ts
import { describe, it, expect } from "vitest";
import { getEntityLedger, type EntityLedgerContext } from "../entity-ledger";
import { computeEntityCashFlow, type EntityMetadata } from "@/engine/entity-cashflow";
import type { ProjectionYear } from "@/engine/types";
import { runProjection } from "@/engine/projection";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { basePlanSettings, buildClientData } from "@/engine/__tests__/fixtures";

/** Adapts a year-invariant owner Map to computeEntityCashFlow's per-year resolver. */
function ownersFrom(map: Map<string, { entityId: string; percent: number }>) {
  return {
    accountEntityOwnersAt: (id: string) => {
      const owner = map.get(id);
      return owner ? [owner] : [];
    },
    candidateAccountIds: [...map.keys()],
  };
}

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

function buildBusinessWithIncomeFixture() {
  const year = makeYear(2026);

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
        flowMode: "annual",
      },
    ],
  ]);

  const incomes = [
    {
      id: "inc-1",
      type: "business" as const,
      name: "Acme revenue",
      annualAmount: 200_000,
      startYear: 2026,
      endYear: 2030,
      growthRate: 0,
      owner: "joint" as const,
      ownerEntityId: "ent-biz",
    },
  ];

  computeEntityCashFlow({
    years: [year],
    entitiesById,
    ...ownersFrom(new Map()),
    giftsByEntityYear: new Map(),
    incomes,
    expenses: [],
    entityFlowOverrides: [],
  });

  const ctx: EntityLedgerContext = {
    year,
    planStartYear: 2026,
    entitiesById,
    accountNamesById: new Map(),
    incomes,
    expenses: [],
    entityFlowOverrides: [],
  };

  return { year, ctx };
}

function buildBusinessWithExpenseFixture() {
  const year = makeYear(2026);
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
        flowMode: "annual",
      },
    ],
  ]);
  const expenses = [
    {
      id: "exp-1",
      type: "other" as const,
      name: "Acme rent",
      annualAmount: 30_000,
      startYear: 2026,
      endYear: 2030,
      growthRate: 0,
      ownerEntityId: "ent-biz",
    },
  ];
  computeEntityCashFlow({
    years: [year],
    entitiesById,
    ...ownersFrom(new Map()),
    giftsByEntityYear: new Map(),
    incomes: [],
    expenses,
    entityFlowOverrides: [],
  });
  const ctx: EntityLedgerContext = {
    year,
    planStartYear: 2026,
    entitiesById,
    accountNamesById: new Map(),
    incomes: [],
    expenses,
    entityFlowOverrides: [],
  };
  return { year, ctx };
}

function buildTrustFixture() {
  const year = makeYear(2026);
  year.accountLedgers["acct-trust"] = {
    beginningValue: 500_000,
    endingValue: 525_000,
    growth: 25_000,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    entries: [
      { category: "income", amount: 12_000, label: "Dividends", sourceId: "div" },
      { category: "expense", amount: -3_000, label: "Trustee fee", sourceId: "fee" },
    ],
  };

  const entitiesById = new Map<string, EntityMetadata>([
    [
      "ent-trust",
      {
        id: "ent-trust",
        name: "Family Trust",
        entityType: "trust",
        trustSubType: "irrevocable",
        isGrantor: false,
        initialValue: 0,
        initialBasis: 0,
        valueGrowthRate: 0,
      },
    ],
  ]);

  const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
    ["acct-trust", { entityId: "ent-trust", percent: 1 }],
  ]);

  computeEntityCashFlow({
    years: [year],
    entitiesById,
    ...ownersFrom(accountEntityOwners),
    giftsByEntityYear: new Map(),
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  });

  const ctx: EntityLedgerContext = {
    year,
    planStartYear: 2026,
    entitiesById,
    accountNamesById: new Map([["acct-trust", "Trust Brokerage"]]),
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  };

  return { year, ctx };
}

// Split-owned (60% trust / 40% household) account where a household withdrawal
// drew the account down. The trust's locked EoY share ignores that withdrawal
// (accrues growth only), so ledger.endingValue × percent diverges from the
// engine's locked share — exactly the H2 reconciliation bug.
function buildSplitOwnedTrustFixture() {
  const year = makeYear(2026);
  year.accountLedgers["acct-trust"] = {
    beginningValue: 500_000,
    // 500k + 25k growth − 100k household withdrawal
    endingValue: 425_000,
    growth: 25_000,
    contributions: 0,
    distributions: 100_000,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    entries: [
      { category: "withdrawal", amount: -100_000, label: "Household withdrawal", sourceId: "wd" },
    ],
  };

  const entitiesById = new Map<string, EntityMetadata>([
    [
      "ent-trust",
      {
        id: "ent-trust",
        name: "Family Trust",
        entityType: "trust",
        trustSubType: "irrevocable",
        isGrantor: false,
        initialValue: 0,
        initialBasis: 0,
        valueGrowthRate: 0,
      },
    ],
  ]);

  const accountEntityOwners = new Map<string, { entityId: string; percent: number }>([
    ["acct-trust", { entityId: "ent-trust", percent: 0.6 }],
  ]);

  computeEntityCashFlow({
    years: [year],
    entitiesById,
    ...ownersFrom(accountEntityOwners),
    giftsByEntityYear: new Map(),
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  });

  const ctx: EntityLedgerContext = {
    year,
    planStartYear: 2026,
    entitiesById,
    accountNamesById: new Map([["acct-trust", "Joint+Trust Brokerage"]]),
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  };

  return { year, ctx };
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
    ...ownersFrom(accountEntityOwners),
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

  it("income section emits flow-base rows for business entities", () => {
    const { year, ctx } = buildBusinessWithIncomeFixture();
    const row = year.entityCashFlow.get("ent-biz");
    expect(row?.kind).toBe("business");
    if (row?.kind !== "business") return;

    const ledger = getEntityLedger("ent-biz", ctx);
    const flowBase = ledger.income.find((r) => r.sourceKind === "flow-base");
    expect(flowBase?.amount).toBeCloseTo(200_000, 2);
    expect(flowBase?.label).toContain("Acme revenue");

    const sum = ledger.income.reduce((a, r) => a + r.amount, 0);
    expect(sum).toBeCloseTo(row.income, 2);
  });

  it("expenses section emits flow-base rows for business entities", () => {
    const { year, ctx } = buildBusinessWithExpenseFixture();
    const row = year.entityCashFlow.get("ent-biz");
    if (row?.kind !== "business") return;

    const ledger = getEntityLedger("ent-biz", ctx);
    const flowBase = ledger.expenses.find((r) => r.sourceKind === "flow-base");
    expect(flowBase?.amount).toBeCloseTo(30_000, 2);
    expect(flowBase?.label).toContain("Acme rent");

    const sum = ledger.expenses.reduce((a, r) => a + r.amount, 0);
    expect(sum).toBeCloseTo(row.expenses, 2);
  });

  it("ending section sums to row.endingTotalValue for a business with growth + flat value", () => {
    const { year, ctx } = buildBusinessFixture();
    const row = year.entityCashFlow.get("ent-biz");
    if (row?.kind !== "business") return;

    const ledger = getEntityLedger("ent-biz", ctx);
    const sum = ledger.ending.reduce((a, r) => a + r.amount, 0);
    expect(sum).toBeCloseTo(row.endingTotalValue, 2);
  });

  it("section sums equal the matching TrustCashFlowRow fields", () => {
    const { year, ctx } = buildTrustFixture();
    const row = year.entityCashFlow.get("ent-trust");
    expect(row?.kind).toBe("trust");
    if (row?.kind !== "trust") return;
    const ledger = getEntityLedger("ent-trust", ctx);
    const sum = (rows: { amount: number }[]) =>
      rows.reduce((a, r) => a + r.amount, 0);
    expect(sum(ledger.growth)).toBeCloseTo(row.growth, 2);
    expect(sum(ledger.income)).toBeCloseTo(row.income, 2);
    expect(sum(ledger.expenses)).toBeCloseTo(row.expenses, 2);
    expect(sum(ledger.ending)).toBeCloseTo(row.endingBalance, 2);
  });

  it("H2: split-owned trust ending uses the locked EoY share so the modal reconciles to the cell", () => {
    const { year, ctx } = buildSplitOwnedTrustFixture();
    const row = year.entityCashFlow.get("ent-trust");
    expect(row?.kind).toBe("trust");
    if (row?.kind !== "trust") return;

    // Engine locked EoY = (500k + 25k growth) × 0.6 = 315k — the trust-table
    // cell. endingValue × share would be 425k × 0.6 = 255k (the old, divergent
    // modal value).
    const locked = year.entityAccountSharesEoY?.get("ent-trust")?.get("acct-trust");
    expect(locked).toBeCloseTo(315_000, 2);
    expect(row.endingBalance).toBeCloseTo(315_000, 2);

    const ledger = getEntityLedger("ent-trust", ctx);
    const sum = ledger.ending.reduce((a, r) => a + r.amount, 0);
    expect(Math.abs(sum - row.endingBalance)).toBeLessThan(0.5);
    expect(sum).toBeCloseTo(315_000, 2);
  });
});

// An account the trust owns ONLY by a mid-horizon gift: no authored entity
// owner at all. The drill-down must still find it — from the engine's
// per-year map — and book it at the value the trust table books.
function buildGiftedIntoTrustFixture(percent: number) {
  const years = [2026, 2027].map((y) => {
    const year = makeYear(y);
    year.accountLedgers["acct-gifted"] = {
      beginningValue: 500_000,
      // A household withdrawal on the split account: the trust's locked share
      // ignores it, so endingValue × percent is NOT the trust-table value.
      endingValue: 425_000,
      growth: 25_000,
      contributions: 0,
      distributions: 100_000,
      internalContributions: 0,
      internalDistributions: 0,
      rmdAmount: 0,
      fees: 0,
      entries: [
        { category: "withdrawal", amount: -100_000, label: "Household withdrawal", sourceId: "wd" },
      ],
    };
    return year;
  });
  const entitiesById = new Map<string, EntityMetadata>([
    [
      "ent-trust",
      {
        id: "ent-trust",
        name: "Family Trust",
        entityType: "trust",
        trustSubType: "irrevocable",
        isGrantor: false,
        initialValue: 0,
        initialBasis: 0,
        valueGrowthRate: 0,
      },
    ],
  ]);
  computeEntityCashFlow({
    years,
    entitiesById,
    accountEntityOwnersAt: (id, y) =>
      id === "acct-gifted" && y >= 2027 ? [{ entityId: "ent-trust", percent }] : [],
    candidateAccountIds: ["acct-gifted"],
    giftsByEntityYear: new Map(),
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  });
  const ctxFor = (year: ProjectionYear): EntityLedgerContext => ({
    year,
    planStartYear: 2026,
    entitiesById,
    accountNamesById: new Map([["acct-gifted", "Gifted Brokerage"]]),
    incomes: [],
    expenses: [],
    entityFlowOverrides: [],
  });
  return { years, ctxFor };
}

describe("getEntityLedger — an account gifted into the trust mid-horizon", () => {
  const endingSum = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0);

  it("shows a 100% gifted account in the ending rows at the trust-table value", () => {
    const { years, ctxFor } = buildGiftedIntoTrustFixture(1);
    const row = years[1].entityCashFlow.get("ent-trust");
    if (row?.kind !== "trust") throw new Error("no trust row");
    const ledger = getEntityLedger("ent-trust", ctxFor(years[1]));
    expect(ledger.ending.map((r) => r.sourceId)).toEqual(["acct-gifted"]);
    expect(endingSum(ledger.ending)).toBeCloseTo(425_000, 2);
    expect(endingSum(ledger.ending)).toBeCloseTo(row.endingBalance, 2);
  });

  it("shows a split gifted account at the locked share the trust table books", () => {
    const { years, ctxFor } = buildGiftedIntoTrustFixture(0.6);
    const row = years[1].entityCashFlow.get("ent-trust");
    if (row?.kind !== "trust") throw new Error("no trust row");
    const ledger = getEntityLedger("ent-trust", ctxFor(years[1]));
    // Locked = (500k + 25k growth) × 0.6 = 315k, not 425k × 0.6 = 255k.
    expect(endingSum(ledger.ending)).toBeCloseTo(315_000, 2);
    expect(endingSum(ledger.ending)).toBeCloseTo(row.endingBalance, 2);
    expect(ledger.growth.map((r) => r.amount)).toEqual([15_000]);
  });

  it("treats a gift-composed share a hair under 1 as full ownership, as the trust row does", () => {
    const { years, ctxFor } = buildGiftedIntoTrustFixture(1 - 1e-12);
    const row = years[1].entityCashFlow.get("ent-trust");
    if (row?.kind !== "trust") throw new Error("no trust row");
    const ledger = getEntityLedger("ent-trust", ctxFor(years[1]));
    expect(ledger.ending.map((r) => r.label)).toEqual(["Gifted Brokerage — ending"]);
    expect(endingSum(ledger.ending)).toBeCloseTo(row.endingBalance, 2);
  });

  it("does not show the account the year before the gift", () => {
    const { years, ctxFor } = buildGiftedIntoTrustFixture(0.6);
    const ledger = getEntityLedger("ent-trust", ctxFor(years[0]));
    expect(ledger.ending).toEqual([]);
    expect(ledger.growth).toEqual([]);
  });
});

describe("getEntityLedger — runProjection integration", () => {
  it("drill-down ending rows sum to the trust row's endingBalance after a 50% gift in 2027", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "hh-checking",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          titlingType: "jtwros",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
          isDefaultChecking: true,
        },
        {
          id: "acc-gifted",
          name: "Gifted Brokerage",
          category: "taxable",
          subType: "brokerage",
          titlingType: "jtwros",
          value: 1_000_000,
          basis: 1_000_000,
          growthRate: 0.05,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planEndYear: 2028 },
      entities: [
        {
          id: "t-gift",
          name: "Gift Trust",
          includeInPortfolio: false,
          isGrantor: false,
          entityType: "trust",
          isIrrevocable: true,
          grantor: "client",
        },
      ],
      giftEvents: [
        { kind: "asset", year: 2027, accountId: "acc-gifted", percent: 0.5, grantor: "client", recipientEntityId: "t-gift" },
      ],
    });
    const years = runProjection(data);
    const y2027 = years.find((y) => y.year === 2027)!;
    const row = y2027.entityCashFlow.get("t-gift");
    if (row?.kind !== "trust") throw new Error("no trust row in 2027");
    expect(row.endingBalance).toBeGreaterThan(0);

    const entitiesById = new Map<string, EntityMetadata>([
      [
        "t-gift",
        {
          id: "t-gift",
          name: "Gift Trust",
          entityType: "trust",
          trustSubType: "irrevocable",
          isGrantor: false,
          initialValue: 0,
          initialBasis: 0,
        },
      ],
    ]);
    const ledger = getEntityLedger("t-gift", {
      year: y2027,
      planStartYear: 2026,
      entitiesById,
      accountNamesById: new Map(data.accounts.map((a) => [a.id, a.name])),
      incomes: [],
      expenses: [],
      entityFlowOverrides: [],
    });
    const sum = ledger.ending.reduce((a, r) => a + r.amount, 0);
    expect(sum).toBeCloseTo(row.endingBalance, 2);
  });
});
