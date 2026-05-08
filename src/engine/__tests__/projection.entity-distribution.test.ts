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
