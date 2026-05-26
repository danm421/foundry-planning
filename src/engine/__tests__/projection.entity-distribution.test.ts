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
