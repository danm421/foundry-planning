/**
 * Verifies non-grantor business entity pass-through tax behavior.
 *
 * Net business income (income - expenses) flows to household taxDetail.ordinaryIncome
 * via the Phase 3 K-1 incidence block at projection.ts:1262-1330. This test locks in
 * that behavior so refactors don't silently regress it.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  Income,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

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

const llcEntity: EntitySummary = {
  id: "llc1",
  name: "Single-Owner LLC",
  includeInPortfolio: true,
  isGrantor: false,
  entityType: "llc",
  taxTreatment: "ordinary",
  distributionPolicyPercent: 0, // 0% — entity retains all earnings
  owners: [{ familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const llcChecking: Account = {
  id: "llc1-checking",
  name: "LLC Checking",
  category: "cash",
  subType: "checking",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "llc1", percent: 1 }],
  isDefaultChecking: true,
};

const llcIncome: Income = {
  id: "i1",
  type: "business",
  name: "LLC Revenue",
  annualAmount: 50_000,
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  owner: "client",
  ownerEntityId: "llc1",
};

function mkData(): ClientData {
  return {
    client,
    accounts: [hhChecking, llcChecking],
    incomes: [llcIncome],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [],
    entities: [llcEntity],
    giftEvents: [],
  };
}

describe("Non-grantor business entity: net income → household tax (regression)", () => {
  it("LLC with $50k net income and 0% distribution still hits taxDetail.ordinaryIncome", () => {
    const years = runProjection(mkData());
    const y0 = years[0];

    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(50_000, 0);
    // Drilldown bySource entry from Phase 3 K-1 block.
    expect(y0.taxDetail!.bySource["entity_passthrough:llc1"]).toEqual({
      type: "ordinary_income",
      amount: 50_000,
    });
  });
});

import type { RealizationModel } from "../types";

const realization100PctOI: RealizationModel = {
  pctOrdinaryIncome: 1.0,
  pctQualifiedDividends: 0,
  pctLtCapitalGains: 0,
  pctTaxExempt: 0,
  turnoverPct: 0,
};

const realizationMixed: RealizationModel = {
  // 40% OI, 30% QDIV, 30% raw LTCG with 50% turnover → 15% STCG, 15% LTCG.
  pctOrdinaryIncome: 0.4,
  pctQualifiedDividends: 0.3,
  pctLtCapitalGains: 0.3,
  pctTaxExempt: 0,
  turnoverPct: 0.5,
};

function entityTaxableAcct(opts: {
  id: string;
  entityId: string;
  value: number;
  growthRate: number;
  realization: RealizationModel;
}): Account {
  return {
    id: opts.id,
    name: `${opts.entityId} Brokerage`,
    category: "taxable",
    subType: "brokerage",
    value: opts.value,
    basis: opts.value,
    growthRate: opts.growthRate,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: opts.entityId, percent: 1 }],
    realization: opts.realization,
  };
}

describe("Non-trust business entity-account realization → household tax detail (B.2)", () => {
  it("non-grantor LLC's taxable-account OI flows to taxDetail.ordinaryIncome", () => {
    // $100k account, 10% growth, 100% OI realization → $10k OI per year.
    const acct = entityTaxableAcct({
      id: "llc1-brokerage",
      entityId: "llc1",
      value: 100_000,
      growthRate: 0.10,
      realization: realization100PctOI,
    });
    const data: ClientData = {
      ...mkData(),
      accounts: [hhChecking, llcChecking, acct],
      incomes: [], // no operating revenue — isolate the realization
    };
    const years = runProjection(data);
    const y0 = years[0];

    // Net business income = 0 (no operating income, no expenses), so K-1
    // incidence contributes 0. The $10k must come purely from the entity-
    // account realization passthrough.
    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(10_000, 0);
  });

  it("mixed-character realization preserves OI / QDIV / STCG buckets on household 1040", () => {
    // $100k account, 10% growth = $10k. Realization: 40% OI, 30% QDIV, 15% STCG, 15% LTCG.
    // Household tax detail should pick up: $4k OI, $3k QDIV, $1.5k STCG.
    // LTCG ($1.5k) is unrealized appreciation, not added at this point.
    const acct = entityTaxableAcct({
      id: "llc1-brokerage",
      entityId: "llc1",
      value: 100_000,
      growthRate: 0.10,
      realization: realizationMixed,
    });
    const data: ClientData = {
      ...mkData(),
      accounts: [hhChecking, llcChecking, acct],
      incomes: [],
    };
    const years = runProjection(data);
    const y0 = years[0];

    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(4_000, 0);
    expect(y0.taxDetail!.dividends).toBeCloseTo(3_000, 0);
    expect(y0.taxDetail!.stCapitalGains).toBeCloseTo(1_500, 0);
  });

  it("non-grantor TRUST-owned account realization stays in yearRealizations[] (regression)", () => {
    // Trust path is unchanged: realization should NOT appear in household
    // taxDetail.ordinaryIncome via this code path.
    const trustEntity: EntitySummary = {
      id: "trust1",
      name: "Test Trust",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      distributionPolicyPercent: 0,
      distributionMode: null,
      owners: [{ familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
    const trustAcct = entityTaxableAcct({
      id: "trust1-brokerage",
      entityId: "trust1",
      value: 100_000,
      growthRate: 0.10,
      realization: realization100PctOI,
    });
    const data: ClientData = {
      ...mkData(),
      accounts: [hhChecking, trustChecking, trustAcct],
      entities: [trustEntity],
      incomes: [],
    };
    const years = runProjection(data);
    const y0 = years[0];

    // The $10k of OI should NOT show up in household taxDetail via the
    // entity-account passthrough. (It may end up there via the trust-tax pass
    // depending on DNI, but the precondition here — distributionPolicyPercent: 0
    // and no distribution mode — keeps it inside the trust.)
    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(0, 0);
  });
});

describe("Grantor non-trust entity: schedule-mode tax uses net income, not raw base row", () => {
  // Regression: a grantor LLC in flowMode "schedule" with an outdated
  // inc.annualAmount used to leak that raw amount into household
  // taxDetail.ordinaryIncome (because the household-tax loop bypassed
  // resolveEntityFlowAmount). Grantor non-trust entities now route through
  // the Phase 3 K-1 incidence block, which uses resolveEntityFlows and
  // therefore respects the schedule grid + subtracts entity expenses.
  it("uses (gross − expense) from schedule grid, not inc.annualAmount", () => {
    const grantorLlc: EntitySummary = {
      id: "llc-g",
      name: "Grantor LLC",
      includeInPortfolio: true,
      isGrantor: true,
      entityType: "llc",
      taxTreatment: "ordinary",
      flowMode: "schedule",
      distributionPolicyPercent: 0,
      owners: [{ familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const grantorChecking: Account = {
      id: "llc-g-checking",
      name: "Grantor LLC Checking",
      category: "cash",
      subType: "checking",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "llc-g", percent: 1 }],
    };
    // The base row's annualAmount is stale ($39,999) — it should be ignored
    // in schedule mode. The schedule grid drives the calculation.
    const staleBaseRow: Income = {
      id: "stale",
      type: "business",
      name: "Old base row",
      annualAmount: 39_999,
      startYear: 2026,
      endYear: 2050,
      growthRate: 0.03,
      owner: "client",
      ownerEntityId: "llc-g",
    };
    const data: ClientData = {
      ...mkData(),
      accounts: [hhChecking, grantorChecking],
      incomes: [staleBaseRow],
      entities: [grantorLlc],
      entityFlowOverrides: [
        { entityId: "llc-g", year: 2026, incomeAmount: 10_000, expenseAmount: 1_000, distributionPercent: 0 },
      ],
    };
    const years = runProjection(data);
    const y0 = years[0];

    // Net = $10k − $1k = $9k. Must NOT pick up the stale $39,999.
    expect(y0.taxDetail!.ordinaryIncome).toBeCloseTo(9_000, 0);
    expect(y0.taxDetail!.bySource["entity_passthrough:llc-g"]).toEqual({
      type: "ordinary_income",
      amount: 9_000,
    });
    // The stale base row id must NOT have leaked into bySource.
    expect(y0.taxDetail!.bySource["stale"]).toBeUndefined();
  });
});

describe("LLC outside-basis bump on retained earnings (Section C)", () => {
  it("non-grantor LLC with $50k net income retained: endingBasis bumps by $50k", () => {
    // 0% distribution → $50k retained. Outside basis must increase by the
    // retained earnings to mirror partnership/S-corp basis tracking.
    const data = mkData(); // mkData defaults to llcEntity with distributionPolicyPercent: 0
    const years = runProjection(data);
    const y0 = years[0];
    const llcRow = y0.entityCashFlow.get("llc1");

    expect(llcRow).toBeDefined();
    expect(llcRow!.kind).toBe("business");
    if (llcRow!.kind !== "business") throw new Error("type narrow");

    // beginningBasis: account basis ($0) + entity initialBasis (default 0) = 0.
    // Retained earnings $50k → endingBasis = $50k.
    expect(llcRow.endingBasis).toBeCloseTo(50_000, 0);
  });
});
