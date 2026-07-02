/**
 * Integration tests for Phase 3 business-account flow wiring.
 *
 * Two mechanics under test:
 *  1. Tax incidence: business-account net income flows to owners' 1040 buckets
 *     (qbi / ordinaryIncome / taxExempt) scaled by ownership %.
 *  2. Distribution: business-account net income × distributionPolicyPercent
 *     flows from the business' child checking → household checking each year.
 *
 * Trusts must NOT trigger this path (they keep the 1041 / grantor passes).
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  Income,
  Expense,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Minimal fixtures ─────────────────────────────────────────────────────────

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2027,
};

const client = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint" as const,
  spouseName: "Bob Test",
  spouseDob: "1980-06-01",
  spouseRetirementAge: 65,
};

const hhChecking: Account = {
  id: "hh-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
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

/** Top-level business account ("biz-llc") with the given overrides. */
function bizAccount(over: Partial<Account> = {}): Account {
  return {
    id: "biz-llc",
    name: "Single-Owner LLC",
    category: "business",
    subType: "llc",
    titlingType: "jtwros",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    businessType: "llc",
    parentAccountId: null,
    distributionPolicyPercent: 1.0,
    flowMode: "annual",
    businessTaxTreatment: "ordinary",
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...over,
  } as Account;
}

/** Child cash account for the business — receives net income for distribution.
 *  Mark as 100% entity-owned by the parent so it isn't picked up by the
 *  family-member default-cash resolver (which would route distributions back
 *  to the same business cash via the legacy-owner normalizer fallback). */
function bizChecking(parentId: string, value = 0): Account {
  return {
    id: `${parentId}-checking`,
    name: `${parentId} Checking`,
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    parentAccountId: parentId,
    owners: [{ kind: "entity", entityId: parentId, percent: 1 }],
    isDefaultChecking: true,
  } as Account;
}

const llcIncome: Income = {
  id: "i1",
  type: "business",
  name: "LLC Revenue",
  annualAmount: 100_000,
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  owner: "client",
  ownerAccountId: "biz-llc",
};

function mkData(overrides: {
  bizOverrides?: Partial<Account>;
  incomes?: Income[];
  expenses?: Expense[];
} = {}): ClientData {
  const biz = bizAccount(overrides.bizOverrides);
  return {
    client,
    accounts: [hhChecking, biz, bizChecking("biz-llc")],
    incomes: overrides.incomes ?? [llcIncome],
    expenses: overrides.expenses ?? [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [],
    entities: [],
    giftEvents: [],
  };
}

/** End-of-year balance of an account from its ledger snapshot. */
function endBalance(year: ReturnType<typeof runProjection>[number], acctId: string): number {
  return year.accountLedgers[acctId]?.endingValue ?? 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Phase 3: business-account tax incidence", () => {
  it("single-owner LLC, ordinary treatment: net income flows to household ordinaryIncome", () => {
    const data = mkData();
    const years = runProjection(data);
    const y0 = years[0];

    const noIncomeYears = runProjection(mkData({ incomes: [] }));

    const taxDelta = y0.expenses.taxes - noIncomeYears[0].expenses.taxes;

    // At ~24% federal + 5% state on $100k, expect ~$29k more tax.
    expect(taxDelta).toBeGreaterThan(20_000);
    expect(taxDelta).toBeLessThan(40_000);
  });
});

describe("Phase 3: tax-treatment mapping", () => {
  it("qbi treatment: bySource key tags the business as QBI", () => {
    const data = mkData({ bizOverrides: { businessTaxTreatment: "qbi" } });
    const years = runProjection(data);
    const y0 = years[0];

    // Phase 3 K-1 attributes the business's pass-through to taxDetail.qbi
    // exclusively. The upstream per-income tax classifier skips
    // ownerAccountId rows so the same dollars no longer also land in
    // ordinaryIncome.
    expect(y0.taxDetail!.qbi).toBeCloseTo(100_000, 0);
    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(0, 0);
    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toEqual({
      type: "qbi",
      amount: 100_000,
    });
  });
});

describe("Phase 3: split family ownership", () => {
  it("client 70% + spouse 30%: full distribution still flows to household", () => {
    const data = mkData({
      bizOverrides: {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.3 },
        ],
      },
    });
    const years = runProjection(data);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
  });
});

describe("Phase 3: business-account distribution flow", () => {
  it("100% distribution: credits household checking with the full net income", () => {
    const data = mkData();
    const years = runProjection(data);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
  });

  it("partial distribution (50%): credits household with half the net income", () => {
    const data = mkData({ bizOverrides: { distributionPolicyPercent: 0.5 } });
    const years = runProjection(data);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(50_000, 0);
  });

  it("null distributionPolicyPercent defaults to 100% (full passthrough)", () => {
    const data = mkData({ bizOverrides: { distributionPolicyPercent: null } });
    const years = runProjection(data);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
  });

  it("distribution audit entry uses 'entity_distribution' category with the business account as sourceId", () => {
    const data = mkData();
    const years = runProjection(data);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
    expect(distEntry!.sourceId).toBe("biz-llc");
  });

  it("loss year: no distribution and no tax incidence", () => {
    const lossExpense: Expense = {
      id: "x1",
      type: "other",
      name: "Big Loss",
      annualAmount: 200_000,
      startYear: 2026,
      endYear: 2026,
      growthRate: 0,
      ownerAccountId: "biz-llc",
    };
    const dataWithLoss: ClientData = {
      ...mkData({ expenses: [lossExpense] }),
    };
    const years = runProjection(dataWithLoss);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    expect(hhEntries.find((e) => e.category === "entity_distribution")).toBeUndefined();

    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toBeUndefined();
  });
});

describe("Phase 3: trust regression — taxTreatment ignored", () => {
  it("trust with taxTreatment set does not trigger Phase 3 incidence or distribution", () => {
    const trustEntity: EntitySummary = {
      id: "trust1",
      name: "Test Trust",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      taxTreatment: "qbi", // should be ignored
      distributionPolicyPercent: 0.5, // should be ignored
      distributionMode: null,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const trustIncome: Income = {
      id: "ti1",
      type: "business",
      name: "Trust Revenue",
      annualAmount: 50_000,
      startYear: 2026,
      endYear: 2050,
      growthRate: 0,
      owner: "client",
      ownerEntityId: "trust1",
    };
    const trustChecking: Account = {
      id: "trust1-checking",
      name: "Trust Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "trust1", percent: 1 }],
      isDefaultChecking: true,
    };

    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking],
      incomes: [trustIncome],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [trustEntity],
      giftEvents: [],
    };

    const years = runProjection(data);
    const y0 = years[0];

    expect(y0.taxDetail!.bySource["business_passthrough:trust1"]).toBeUndefined();

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    expect(hhEntries.find((e) => e.category === "entity_distribution")).toBeUndefined();
  });
});

describe("Phase 3: business cash account nets to retained earnings (regression)", () => {
  it("100% distribution: business cash nets to ~$0 every year (no phantom deficit)", () => {
    // $100k income, no expenses, 100% distribution → nothing retained → biz cash ~$0.
    const multiYearPlan: PlanSettings = { ...planSettings, planEndYear: 2030 };
    const data: ClientData = { ...mkData(), planSettings: multiYearPlan };
    const years = runProjection(data);
    expect(years.length).toBe(5);
    for (const y of years) {
      expect(endBalance(y, "biz-llc-checking")).toBeCloseTo(0, 0);
    }
  });

  it("50% distribution: business cash accumulates the retained half each year", () => {
    // $100k net income × (1 - 0.5) = $50k retained per year, compounding (no growth).
    const multiYearPlan: PlanSettings = { ...planSettings, planEndYear: 2028 };
    const data: ClientData = {
      ...mkData({ bizOverrides: { distributionPolicyPercent: 0.5 } }),
      planSettings: multiYearPlan,
    };
    const years = runProjection(data);
    expect(years.length).toBe(3);
    expect(endBalance(years[0], "biz-llc-checking")).toBeCloseTo(50_000, 0);
    expect(endBalance(years[1], "biz-llc-checking")).toBeCloseTo(100_000, 0);
    expect(endBalance(years[2], "biz-llc-checking")).toBeCloseTo(150_000, 0);
  });

  it("business cash ledger carries granular income / expense / distribution entries", () => {
    // $100k income, $30k expense, 100% distribution.
    const expense: Expense = {
      id: "e1",
      type: "other",
      name: "LLC Expense",
      annualAmount: 30_000,
      startYear: 2026,
      endYear: 2050,
      growthRate: 0,
      ownerAccountId: "biz-llc",
    };
    const data = mkData({ expenses: [expense] });
    const y0 = runProjection(data)[0];
    const entries = y0.accountLedgers["biz-llc-checking"].entries;

    const inc = entries.find((e) => e.category === "income");
    const exp = entries.find((e) => e.category === "expense");
    const dist = entries.find((e) => e.category === "entity_distribution");
    expect(inc?.amount).toBeCloseTo(100_000, 0);
    expect(exp?.amount).toBeCloseTo(-30_000, 0);
    // netIncome = $70k, 100% distributed.
    expect(dist?.amount).toBeCloseTo(-70_000, 0);
    // Nets to ~$0.
    expect(endBalance(y0, "biz-llc-checking")).toBeCloseTo(0, 0);
  });
});

describe("Phase 3: multi-year 2-owner LLC integration", () => {
  it("60/40 owners, 50% distribution, 3-year QBI projection: cash + tax accumulate correctly", () => {
    const multiYearPlan: PlanSettings = { ...planSettings, planEndYear: 2028 };
    const data: ClientData = {
      ...mkData({
        bizOverrides: {
          businessTaxTreatment: "qbi",
          distributionPolicyPercent: 0.5,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.4 },
          ],
        },
      }),
      planSettings: multiYearPlan,
    };
    const years = runProjection(data);
    expect(years).toHaveLength(3);

    // Each year, household receives a $50k entity_distribution audit entry
    // (net income $100k × 50% distribution policy).
    for (const y of years) {
      const distEntries = y.accountLedgers["hh-checking"].entries.filter(
        (e) => e.category === "entity_distribution",
      );
      expect(distEntries).toHaveLength(1);
      expect(distEntries[0].amount).toBeCloseTo(50_000, 0);
    }

    for (const y of years) {
      const src = y.taxDetail!.bySource["business_passthrough:biz-llc"];
      expect(src).toBeDefined();
      expect(src!.type).toBe("qbi");
      expect(src!.amount).toBeCloseTo(100_000, 0);
    }
  });
});

describe("Display: Business column reflects business-account distributions", () => {
  it("LLC with 100% distribution: y.income.business equals distribution", () => {
    const data = mkData({ bizOverrides: { distributionPolicyPercent: 1.0 } });
    const years = runProjection(data);
    const y0 = years[0];

    expect(y0.income.business).toBeCloseTo(100_000, 0);
  });

  it("LLC with 0% distribution: y.income.business is 0", () => {
    const data = mkData({ bizOverrides: { distributionPolicyPercent: 0 } });
    const years = runProjection(data);
    const y0 = years[0];

    expect(y0.income.business).toBeCloseTo(0, 0);
  });
});

describe("Phase 3: business with no child cash account", () => {
  // A business asset created without a child default-checking cash account is
  // the default state in the UI (creation doesn't auto-provision one). Pre-fix,
  // the Phase-3 distribution loop short-circuited when no businessCash was
  // found, silently dropping the business's net income — household routing had
  // already excluded the business-tagged income/expense rows, so nothing
  // reached the owner's cash flow.
  function mkDataNoBizCash(over: Partial<Account> = {}): ClientData {
    return {
      client,
      accounts: [hhChecking, bizAccount(over)], // ← no bizChecking
      incomes: [llcIncome],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [],
      giftEvents: [],
    };
  }

  it("100% distribution: net income still reaches owner's checking", () => {
    const years = runProjection(mkDataNoBizCash());
    const y0 = years[0];

    const distEntry = y0.accountLedgers["hh-checking"].entries.find(
      (e) => e.category === "entity_distribution",
    );
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
  });

  it("y.income.business and y.netCashFlow reflect the distributed cash", () => {
    const years = runProjection(mkDataNoBizCash());
    const y0 = years[0];

    expect(y0.income.business).toBeCloseTo(100_000, 0);
    // Cash flowing in: $100k distribution. Cash flowing out: taxes on the
    // pass-through income (~$29k at the test flat rates). Net should be
    // positive — pre-fix it was negative (taxes with no offsetting income).
    expect(y0.netCashFlow).toBeGreaterThan(50_000);
  });

  it("partial distribution (50%): half flows to owner; retained share stays $0 with no cash bucket", () => {
    const years = runProjection(mkDataNoBizCash({ distributionPolicyPercent: 0.5 }));
    const y0 = years[0];

    const distEntry = y0.accountLedgers["hh-checking"].entries.find(
      (e) => e.category === "entity_distribution",
    );
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(50_000, 0);
  });
});

describe("Phase 3: distribution routes to owner's default cash account", () => {
  it("routes to the primary owner's account when multiple household checkings exist", () => {
    // Two non-entity isDefaultChecking accounts. A 100%-client business's
    // distribution lands in the client-only checking rather than the joint one.
    const clientOnlyChecking: Account = {
      id: "client-checking",
      name: "Client Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      isDefaultChecking: true,
    };
    const data: ClientData = {
      ...mkData(),
      accounts: [hhChecking, clientOnlyChecking, bizAccount(), bizChecking("biz-llc")],
    };
    const years = runProjection(data);
    const y0 = years[0];

    const clientEntries = y0.accountLedgers["client-checking"].entries;
    const distOnClient = clientEntries.find((e) => e.category === "entity_distribution");
    expect(distOnClient).toBeDefined();
    expect(distOnClient!.amount).toBeCloseTo(100_000, 0);

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    expect(hhEntries.find((e) => e.category === "entity_distribution")).toBeUndefined();
  });

  it("falls back to household cash when no client-specific default checking", () => {
    const hhCashNotDefault: Account = { ...hhChecking, isDefaultChecking: false };
    const data: ClientData = {
      ...mkData(),
      accounts: [hhCashNotDefault, bizAccount(), bizChecking("biz-llc")],
    };
    const years = runProjection(data);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
  });
});

describe("Phase 3 (entity model): EntitySummary business distributes to household", () => {
  // BUG #17 regression. Entity-model businesses (EntitySummary rows with
  // entityType "llc"|"s_corp"|"partnership", income/expense tagged via
  // ownerEntityId) never distributed: the engine wrote NO entity_distribution
  // entries for them, so annualDistribution was structurally 0 and
  // endingTotalValue compounded by the full net income forever.
  //
  // Setup: LLC entity, $1M flat value (0% growth), distributionPolicyPercent
  // 0.6. Income $400k and expense $100k tagged via ownerEntityId → net income
  // $300k. Distribution = $300k × 0.6 = $180k; retained = $120k.
  const llcEntity: EntitySummary = {
    id: "llc-ent",
    name: "Entity-Model LLC",
    includeInPortfolio: true,
    isGrantor: false,
    entityType: "llc",
    distributionPolicyPercent: 0.6,
    distributionMode: null,
    flowMode: "annual",
    value: 1_000_000,
    basis: 1_000_000,
    valueGrowthRate: 0,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };
  const entChecking: Account = {
    id: "llc-ent-checking",
    name: "LLC Entity Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: "llc-ent", percent: 1 }],
    isDefaultChecking: true,
  } as Account;
  const entIncome: Income = {
    id: "ei1",
    type: "business",
    name: "LLC Entity Revenue",
    annualAmount: 400_000,
    startYear: 2026,
    endYear: 2050,
    growthRate: 0,
    owner: "client",
    ownerEntityId: "llc-ent",
  };
  const entExpense: Expense = {
    id: "ex1",
    type: "other",
    name: "LLC Entity Expense",
    annualAmount: 100_000,
    startYear: 2026,
    endYear: 2050,
    growthRate: 0,
    ownerEntityId: "llc-ent",
  };

  function mkEntityData(): ClientData {
    return {
      client,
      accounts: [hhChecking, entChecking],
      incomes: [entIncome],
      expenses: [entExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [llcEntity],
      giftEvents: [],
    };
  }

  it("writes an entity_distribution debit of $180k on the entity's cash account", () => {
    const y0 = runProjection(mkEntityData())[0];
    const entEntries = y0.accountLedgers["llc-ent-checking"].entries;
    const distDebit = entEntries.find(
      (e) => e.category === "entity_distribution" && e.amount < 0,
    );
    expect(distDebit).toBeDefined();
    expect(distDebit!.amount).toBeCloseTo(-180_000, 0);
  });

  it("credits the household checking with a matching $180k distribution", () => {
    const y0 = runProjection(mkEntityData())[0];
    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distCredit = hhEntries.find(
      (e) => e.category === "entity_distribution" && e.amount > 0,
    );
    expect(distCredit).toBeDefined();
    expect(distCredit!.amount).toBeCloseTo(180_000, 0);
  });

  it("entity cashflow row: annualDistribution $180k, retainedEarnings $120k, endingTotalValue $1.12M", () => {
    const y0 = runProjection(mkEntityData())[0];
    const row = y0.entityCashFlow.get("llc-ent");
    expect(row).toBeDefined();
    expect(row!.kind).toBe("business");
    if (row!.kind !== "business") throw new Error("expected business row");
    expect(row!.annualDistribution).toBeCloseTo(180_000, 0);
    expect(row!.retainedEarnings).toBeCloseTo(120_000, 0);
    // Pre-fix: endingTotalValue = $1M + full $300k net income = $1.3M.
    // Post-fix: $1M + retained $120k = $1.12M.
    expect(row!.endingTotalValue).toBeCloseTo(1_120_000, 0);
  });
});

describe("Phase 3 (entity model): EntitySummary business tax incidence (H1)", () => {
  // H1 regression. Non-trust EntitySummary businesses (llc/s_corp/partnership)
  // distribute cash to the household (the sweep tested above), but their
  // pass-through income was never taxed: the household-1040 loop skips every
  // ownerEntityId row (projection.ts:1834-1840) on the promise that the Phase-3
  // K-1 block taxes them, yet that block only iterated account-model businesses.
  // No entity K-1 incidence existed, so $100k of LLC income was reported as
  // household income (via the distribution) yet cost $0 in tax.
  const CLIENT = LEGACY_FM_CLIENT;

  function bizEntity(
    taxTreatment: "qbi" | "ordinary" | "non_taxable",
    over: Partial<EntitySummary> = {},
  ): EntitySummary {
    return {
      id: "llc1",
      name: "Tax LLC",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "llc",
      distributionPolicyPercent: 1,
      distributionMode: null,
      flowMode: "annual",
      value: 0,
      basis: 0,
      valueGrowthRate: 0,
      taxTreatment,
      owners: [{ kind: "family_member", familyMemberId: CLIENT, percent: 1 }],
      ...over,
    };
  }

  const entChecking: Account = {
    id: "llc1-checking",
    name: "LLC1 Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: "llc1", percent: 1 }],
    isDefaultChecking: true,
  } as Account;

  const entIncome: Income = {
    id: "ei1",
    type: "business",
    name: "LLC1 Revenue",
    annualAmount: 100_000,
    startYear: 2026,
    endYear: 2050,
    growthRate: 0,
    owner: "client",
    ownerEntityId: "llc1",
  };

  function mkTaxData(
    taxTreatment: "qbi" | "ordinary" | "non_taxable",
    opts: { incomes?: Income[]; entityOver?: Partial<EntitySummary> } = {},
  ): ClientData {
    return {
      client,
      accounts: [hhChecking, entChecking],
      incomes: opts.incomes ?? [entIncome],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [bizEntity(taxTreatment, opts.entityOver)],
      giftEvents: [],
    };
  }

  it("qbi treatment: net income flows to household QBI bucket (no ordinary double-count)", () => {
    const y0 = runProjection(mkTaxData("qbi"))[0];
    expect(y0.taxDetail!.qbi).toBeCloseTo(100_000, 0);
    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(0, 0);
    expect(y0.taxDetail!.bySource["business_passthrough:llc1"]).toEqual({
      type: "qbi",
      amount: 100_000,
    });
  });

  it("ordinary treatment: raises household tax vs a no-entity-income baseline", () => {
    const withIncome = runProjection(mkTaxData("ordinary"))[0];
    const without = runProjection(mkTaxData("ordinary", { incomes: [] }))[0];
    expect(withIncome.taxDetail!.ordinaryIncome).toBeCloseTo(100_000, 0);
    // Real P&L effect: the pass-through income now costs tax (~$29k at the
    // test flat rates). Pre-fix the delta was ~$0 — cash with no tax.
    expect(withIncome.expenses.taxes - without.expenses.taxes).toBeGreaterThan(20_000);
  });

  it("non_taxable treatment: raises taxExempt but never taxExemptInterest (not muni interest)", () => {
    const y0 = runProjection(mkTaxData("non_taxable"))[0];
    expect(y0.taxDetail!.taxExempt).toBeCloseTo(100_000, 0);
    expect(y0.taxDetail!.taxExemptInterest).toBeCloseTo(0, 0);
    expect(y0.taxDetail!.bySource["business_passthrough:llc1"]).toEqual({
      type: "tax_exempt",
      amount: 100_000,
    });
  });

  it("grantor non-trust entity is taxed too (the distribution sweep ignores grantor status)", () => {
    const y0 = runProjection(mkTaxData("qbi", { entityOver: { isGrantor: true } }))[0];
    expect(y0.taxDetail!.qbi).toBeCloseTo(100_000, 0);
    expect(y0.taxDetail!.bySource["business_passthrough:llc1"]).toBeDefined();
  });
});

describe("Phase 3: business loss-year cash handling (step 12c gap-fill)", () => {
  // $100k income, $150k expense → -$50k loss.
  const lossExpense: Expense = {
    id: "x1",
    type: "other",
    name: "Big Loss",
    annualAmount: 150_000,
    startYear: 2026,
    endYear: 2026,
    growthRate: 0,
    ownerAccountId: "biz-llc",
  };

  it("loss with no liquidatable holdings: business cash goes negative + entity_overdraft", () => {
    // Business owns only its cash account (untappable), so the deficit stays.
    const data = mkData({ expenses: [lossExpense] });
    const y0 = runProjection(data)[0];

    // No distribution in a loss year.
    const hhDist = y0.accountLedgers["hh-checking"].entries.find(
      (e) => e.category === "entity_distribution",
    );
    expect(hhDist).toBeUndefined();
    // The loss landed on business cash and stayed (nothing to liquidate).
    expect(endBalance(y0, "biz-llc-checking")).toBeCloseTo(-50_000, 0);
    // Entity gap-fill warnings surface under `trustWarnings` (entityGapFillWarnings
    // is merged into it at projection.ts:4655).
    expect(y0.trustWarnings?.some((w) => w.code === "entity_overdraft")).toBe(true);
  });

  it("loss with a liquidatable business-owned taxable account: it's drained first", () => {
    // -$50k loss, but the business owns a $200k taxable account → gap-fill
    // liquidates $50k to refill business cash back toward $0.
    const bizTaxable: Account = {
      id: "biz-taxable",
      name: "Business Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 200_000,
      basis: 200_000, // full basis → no cap gain on liquidation
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "biz-llc", percent: 1 }],
    } as Account;
    const data: ClientData = {
      ...mkData({ expenses: [lossExpense] }),
      accounts: [hhChecking, bizAccount(), bizChecking("biz-llc"), bizTaxable],
    };
    const y0 = runProjection(data)[0];

    // Business cash refilled to ~$0; the taxable account funded the $50k.
    expect(endBalance(y0, "biz-llc-checking")).toBeCloseTo(0, 0);
    expect(endBalance(y0, "biz-taxable")).toBeCloseTo(150_000, 0);
    // No overdraft: gap-fill fully covered the loss. `trustWarnings` is omitted
    // from the year object entirely when there's nothing to report (it's only
    // populated when warnings exist — projection.ts:4667), so normalize the
    // undefined-vs-empty case before asserting absence.
    expect(
      (y0.trustWarnings ?? []).some((w) => w.code === "entity_overdraft"),
    ).toBe(false);
  });
});
