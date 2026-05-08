/**
 * Integration tests for Phase 3 entity-flows engine wiring.
 *
 * Two mechanics under test:
 *  1. Tax incidence: business-entity net income flows to owners' 1040 buckets
 *     (qbi / ordinaryIncome / taxExempt) scaled by ownership %.
 *  2. Distribution: business-entity net income × distributionPolicyPercent
 *     flows from entity checking → household checking each year.
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

/** Entity checking — fully owned by the LLC. */
function entityChecking(entityId: string, value = 0): Account {
  return {
    id: `${entityId}-checking`,
    name: `${entityId} Checking`,
    category: "cash",
    subType: "checking",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId, percent: 1 }],
    isDefaultChecking: true,
  };
}

const llcEntity: EntitySummary = {
  id: "llc1",
  name: "Single-Owner LLC",
  includeInPortfolio: true,
  isGrantor: false,
  entityType: "llc",
  taxTreatment: "ordinary",
  distributionPolicyPercent: 1.0,
  owners: [{ familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const llcIncome: Income = {
  id: "i1",
  type: "business",
  name: "LLC Revenue",
  annualAmount: 100_000,
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  owner: "client",
  ownerEntityId: "llc1",
};

function mkData(overrides: {
  entity?: Partial<EntitySummary>;
  incomes?: Income[];
  expenses?: Expense[];
} = {}): ClientData {
  const entity = overrides.entity ? { ...llcEntity, ...overrides.entity } : llcEntity;
  return {
    client,
    accounts: [hhChecking, entityChecking("llc1")],
    incomes: overrides.incomes ?? [llcIncome],
    expenses: overrides.expenses ?? [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [],
    entities: [entity],
    giftEvents: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Phase 3: business entity tax incidence", () => {
  it("single-owner LLC, ordinary treatment: net income flows to household ordinaryIncome", () => {
    const data = mkData();
    const years = runProjection(data);
    const y0 = years[0];

    // Compare to a counterfactual where the entity has $0 net income.
    const noIncomeData = mkData({ incomes: [] });
    const noIncomeYears = runProjection(noIncomeData);

    const taxDelta = y0.expenses.taxes - noIncomeYears[0].expenses.taxes;

    // At ~24% federal + 5% state on $100k, expect ~$29k more tax. Allow loose bound.
    expect(taxDelta).toBeGreaterThan(20_000);
    expect(taxDelta).toBeLessThan(40_000);
  });
});

describe("Phase 3: tax-treatment mapping", () => {
  it("qbi treatment: net income lands in taxDetail.qbi (deduction-eligible)", () => {
    // NOTE: flat mode taxes QBI and ordinary identically via taxableIncome
    // accumulation (see projection.ts ~L1256). We therefore assert bucket
    // assignment directly rather than comparing tax totals, which would be
    // equal in flat mode regardless of treatment.
    const data = mkData({ entity: { taxTreatment: "qbi" } });
    const years = runProjection(data);
    const y0 = years[0];

    // The $100k pass-through should land in taxDetail.qbi, not ordinaryIncome.
    expect(y0.taxDetail!.qbi).toBeCloseTo(100_000, 0);
    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(0, 0);
  });

  it("non_taxable treatment: zero tax incidence (income flows to taxExempt)", () => {
    const data = mkData({ entity: { taxTreatment: "non_taxable" } });
    const years = runProjection(data);
    const y0 = years[0];

    // Compare to no-income baseline — taxes should be equal (within rounding).
    const noIncomeYears = runProjection(mkData({ incomes: [] }));
    expect(y0.expenses.taxes).toBeCloseTo(noIncomeYears[0].expenses.taxes, 0);
  });
});

describe("Phase 3: ownership gap", () => {
  it("ownership gap: only known shares taxed; full distribution still flows to household", () => {
    // Owners sum to 0.7 — there's a 30% legacy gap.
    const data = mkData({
      entity: {
        owners: [
          { familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
          { familyMemberId: LEGACY_FM_SPOUSE, percent: 0.2 },
        ],
      },
    });
    const years = runProjection(data);
    const y0 = years[0];

    // Tax incidence: only $70k taxed (50% + 20% of $100k).
    const noIncomeYears = runProjection(mkData({ incomes: [] }));
    const taxDelta = y0.expenses.taxes - noIncomeYears[0].expenses.taxes;
    // At ~29% combined federal+state on $70k → ~$20k extra tax.
    expect(taxDelta).toBeGreaterThan(15_000);
    expect(taxDelta).toBeLessThan(25_000);

    // Distribution still 100% (P3-7): household gets full $100k.
    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
  });
});

describe("Phase 3: business entity distribution flow", () => {
  it("100% distribution: entity net income flows to household checking", () => {
    const data = mkData(); // 100% distribution, $100k net
    const years = runProjection(data);
    const y0 = years[0];

    // Compare to no-income baseline: household checking should be ~$100k higher.
    const noIncomeData = mkData({ incomes: [] });
    const noIncomeYears = runProjection(noIncomeData);

    const hhDelta =
      y0.accountLedgers["hh-checking"].endingValue -
      noIncomeYears[0].accountLedgers["hh-checking"].endingValue;

    // Inflow ≈ $100k pre-tax. Tax debits are also higher (~$29k extra), so the
    // net delta is roughly $100k - $29k ≈ $71k. We just check direction + bound.
    expect(hhDelta).toBeGreaterThan(50_000);
    expect(hhDelta).toBeLessThan(110_000);
  });

  it("partial distribution (50%): only half flows to household; rest retained in entity", () => {
    const data = mkData({ entity: { distributionPolicyPercent: 0.5 } });
    const years = runProjection(data);
    const y0 = years[0];

    // Entity checking should hold the retained half.
    // Started at $0, no growth, +$100k income, -$50k distribution → $50k.
    const entityLedger = y0.accountLedgers["llc1-checking"];
    expect(entityLedger.endingValue).toBeCloseTo(50_000, 0);
  });

  it("null distributionPolicyPercent defaults to 100% (full passthrough)", () => {
    const data = mkData({ entity: { distributionPolicyPercent: null } });
    const years = runProjection(data);
    const y0 = years[0];

    // Entity checking should be empty after distribution (started 0, +100k income, -100k dist).
    const entityLedger = y0.accountLedgers["llc1-checking"];
    expect(entityLedger.endingValue).toBeCloseTo(0, 0);
  });

  it("distribution audit entry uses 'entity_distribution' category", () => {
    const data = mkData();
    const years = runProjection(data);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(100_000, 0);
    expect(distEntry!.sourceId).toBe("llc1");
  });

  it("loss year: no distribution and no tax incidence; loss retained in entity", () => {
    const lossExpense: Expense = {
      id: "x1",
      type: "other",
      name: "Big Loss",
      annualAmount: 200_000,
      startYear: 2026,
      endYear: 2026,
      growthRate: 0,
      ownerEntityId: "llc1",
    };
    // Income $100k - expense $200k = -$100k net. We seed the entity checking
    // with $300k so the expense actually clears.
    const dataWithSeed = {
      ...mkData({ expenses: [lossExpense] }),
      accounts: [hhChecking, entityChecking("llc1", 300_000)],
    };
    const years = runProjection(dataWithSeed);
    const y0 = years[0];

    // No entity_distribution entry on household checking
    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    expect(hhEntries.find((e) => e.category === "entity_distribution")).toBeUndefined();

    // Tax incidence: no entry in bySource for this entity
    expect(y0.taxDetail!.bySource["entity_passthrough:llc1"]).toBeUndefined();

    // Entity checking ends at: 300k seed + $100k income - $200k expense = $200k
    expect(y0.accountLedgers["llc1-checking"].endingValue).toBeCloseTo(200_000, 0);
  });
});

describe("Phase 3: trust regression — taxTreatment ignored", () => {
  it("trust with taxTreatment set does not trigger Phase 3 incidence or distribution", () => {
    // Build a non-grantor irrevocable trust with taxTreatment set (which the
    // engine MUST ignore — trusts use the 1041 path).
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
      owners: [{ familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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

    // No Phase 3 bySource key for the trust
    expect(y0.taxDetail!.bySource["entity_passthrough:trust1"]).toBeUndefined();

    // No entity_distribution ledger entry on household checking
    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    expect(hhEntries.find((e) => e.category === "entity_distribution")).toBeUndefined();
  });
});

describe("Phase 3: isGrantor=true business entity regression", () => {
  it("isGrantor=true LLC: Phase 3 does not fire (uses grantor path instead)", () => {
    // The "Pass-through taxation" checkbox on business-form.tsx sets isGrantor=true.
    // The existing grantor pipeline already adds the entity's income to
    // taxDetail/taxableIncome via computeIncome's grantor filter. Phase 3 must
    // skip such entities to avoid double-counting.
    const data = mkData({ entity: { isGrantor: true } });
    const noIncomeData = mkData({ entity: { isGrantor: true }, incomes: [] });

    const taxDelta =
      runProjection(data)[0].expenses.taxes
      - runProjection(noIncomeData)[0].expenses.taxes;

    // Tax increase should be SINGLE-pass (~$29k on $100k at 29% combined),
    // not double (~$58k). Same bound as the ordinary single-owner test.
    expect(taxDelta).toBeGreaterThan(20_000);
    expect(taxDelta).toBeLessThan(40_000);

    // Phase 3 bySource entry should be ABSENT (Phase 3 skipped this entity).
    const y0 = runProjection(data)[0];
    expect(y0.taxDetail!.bySource["entity_passthrough:llc1"]).toBeUndefined();
  });
});

describe("Phase 3: multi-year 2-owner LLC integration", () => {
  it("60/40 owners, 50% distribution, 3-year QBI projection: cash + tax accumulate correctly", () => {
    const llc60_40: EntitySummary = {
      ...llcEntity,
      taxTreatment: "qbi",
      distributionPolicyPercent: 0.5,
      owners: [
        { familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
        { familyMemberId: LEGACY_FM_SPOUSE, percent: 0.4 },
      ],
    };
    // 3-year projection
    const multiYearPlan: PlanSettings = {
      ...planSettings,
      planEndYear: 2028,
    };
    const data: ClientData = {
      ...mkData({ entity: llc60_40 }),
      planSettings: multiYearPlan,
    };
    const years = runProjection(data);
    expect(years).toHaveLength(3);

    // Each year: $100k income, no expenses → $50k distribution to household,
    // $50k retained in entity. After 3 years, entity should hold $150k.
    expect(years[2].accountLedgers["llc1-checking"].endingValue).toBeCloseTo(
      150_000,
      0,
    );

    // Each year, household receives a $50k entity_distribution audit entry.
    for (const y of years) {
      const distEntries = y.accountLedgers["hh-checking"].entries.filter(
        (e) => e.category === "entity_distribution",
      );
      expect(distEntries).toHaveLength(1);
      expect(distEntries[0].amount).toBeCloseTo(50_000, 0);
    }

    // Each year, taxDetail.bySource includes the entity passthrough.
    for (const y of years) {
      const src = y.taxDetail!.bySource["entity_passthrough:llc1"];
      expect(src).toBeDefined();
      expect(src!.type).toBe("qbi");
      expect(src!.amount).toBeCloseTo(100_000, 0);
    }
  });
});

describe("Phase 2: per-year distribution % override", () => {
  it("override 0.25 in year Y is honored over the entity base 1.0", () => {
    const data = mkData({ entity: { distributionPolicyPercent: 1.0 } });
    const dataWithOverride = {
      ...data,
      entityFlowOverrides: [
        { entityId: "llc1", year: 2026, distributionPercent: 0.25 },
      ],
    };
    const years = runProjection(dataWithOverride);
    const y0 = years[0];

    // $100k net × 0.25 = $25k distributed; $75k retained in entity.
    const entityLedger = y0.accountLedgers["llc1-checking"];
    expect(entityLedger.endingValue).toBeCloseTo(75_000, 0);

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(25_000, 0);
  });

  it("override income amount in year Y replaces base+growth", () => {
    const data = mkData(); // 100% distribution, base $100k income
    const dataWithOverride = {
      ...data,
      entityFlowOverrides: [
        { entityId: "llc1", year: 2026, incomeAmount: 250_000 },
      ],
    };
    const years = runProjection(dataWithOverride);
    const y0 = years[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(250_000, 0);
  });
});
