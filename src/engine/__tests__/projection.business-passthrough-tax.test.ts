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
