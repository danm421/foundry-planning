import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import { snapshotFromTree } from "../snapshot";

const tree = {
  client: { firstName: "A", lastName: "B", dateOfBirth: "1960-04-02", spouseDob: "1962-09-15", retirementAge: 65, planEndAge: 95, filingStatus: "married_joint" },
  planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.03, residenceState: "PA", capitalLossCarryforwardLongTerm: 8_000, capitalLossCarryforwardShortTerm: null },
  incomes: [
    { id: "i1", type: "salary", name: "Acme", annualAmount: 150_000, startYear: 2026, endYear: 2040, growthRate: 0.03, owner: "client" },
    { id: "i2", type: "other", name: "Policy income", annualAmount: 1, startYear: 2026, endYear: 2040, growthRate: 0, owner: "client", source: "policy" },
  ],
  expenses: [
    { id: "e1", type: "living", name: "Living", annualAmount: 100_000, startYear: 2026, endYear: 2060, growthRate: 0.03, isDefault: true, startYearRef: null },
    { id: "e2", type: "insurance", name: "Policy premium", annualAmount: 4_000, startYear: 2026, endYear: 2060, growthRate: 0, source: "policy" },
  ],
  savingsRules: [
    { id: "r1", accountId: "a1", annualAmount: 5_000, startYear: 2026, endYear: 2040, isDeductible: true },
    { id: "r2", accountId: "a1", annualAmount: 0, startYear: 2026, endYear: 2040, annualPercent: 0.1, contributeMax: false, isDeductible: true },
    { id: "r3", accountId: "a1", annualAmount: 0, startYear: 2026, endYear: 2040, annualPercent: null, contributeMax: true, isDeductible: true },
    { id: "r4", accountId: "a1", annualAmount: 9_000, startYear: 2026, endYear: 2040, scheduleOverrides: { 2027: 11_000, 2028: 0 }, isDeductible: true },
  ],
  accounts: [{ id: "a1", name: "401(k)", category: "retirement", subType: "401k", value: 0, basis: 0, growthRate: 0.07, rmdEnabled: false }],
  entities: [{ id: "en1", name: "Blue Harbor", entityType: "partnership", taxTreatment: "qbi", includeInPortfolio: false, isGrantor: false }, { id: "en2", includeInPortfolio: false, isGrantor: false }],
  familyMembers: [{ id: "fm1", role: "child", relationship: "child", firstName: "K", lastName: null, dateOfBirth: "2015-01-01" }],
  medicareCoverage: [{ owner: "client", enrollmentYear: null, coverageType: "original", medigapMonthlyAt65: null, partDPlanMonthlyAt65: null, priorYearMagi: 190_000 }],
  liabilities: [], withdrawalStrategy: [], giftEvents: [],
} as unknown as ClientData;

describe("snapshotFromTree", () => {
  it("narrows the engine tree to the rule columns, drops synthesized policy rows, and takes deductions from the db rows", () => {
    const s = snapshotFromTree(tree, [{ id: "d1", type: "charitable", name: "Church", annualAmount: 2_000, growthRate: 0, startYear: 2026, endYear: 2060 }]);
    expect(s.client).toEqual({ filingStatus: "married_joint", dateOfBirth: "1960-04-02", spouseDob: "1962-09-15" });
    expect(s.planSettings).toEqual({ planStartYear: 2026, planEndYear: 2060, inflationRate: 0.03, residenceState: "PA", capitalLossCarryforwardLt: 8_000, capitalLossCarryforwardSt: null });
    expect(s.incomes.map((i) => i.id)).toEqual(["i1"]);
    expect(s.incomes[0]).toMatchObject({ inflationStartYear: null, ownerAccountId: null, ownerEntityId: null, linkedPropertyId: null, ssBenefitMode: null, piaMonthly: null, claimingAge: null });
    expect(s.expenses.map((e) => e.id)).toEqual(["e1"]);
    expect(s.expenses[0]).toMatchObject({ isDefault: true, startYearRef: null, inflationStartYear: null });
    expect(s.entities).toEqual([{ id: "en1", name: "Blue Harbor", entityType: "partnership", taxTreatment: "qbi" }, { id: "en2", name: "", entityType: "trust", taxTreatment: "ordinary" }]);
    expect(s.familyMembers[0]).toMatchObject({ claimedAsDependent: "auto" });
    expect(s.medicare).toEqual([{ owner: "client", priorYearMagi: 190_000 }]);
    expect(s.deductions[0].id).toBe("d1");
  });

  it("drops the engine-only columns the rules must never read", () => {
    const s = snapshotFromTree(tree, []);
    // A wholesale `...row` spread would smuggle `isDeductible` / `value` / `growthRate`
    // onto the snapshot and let a rule quietly depend on a column no write can patch.
    expect(s.savingsRules).toEqual([
      // The mode fields decide which figure the engine spends, so they must survive the narrowing —
      // and an absent one must land as null/false, never undefined.
      { id: "r1", accountId: "a1", annualAmount: 5_000, startYear: 2026, endYear: 2040, annualPercent: null, contributeMax: false, overrideYears: [] },
      { id: "r2", accountId: "a1", annualAmount: 0, startYear: 2026, endYear: 2040, annualPercent: 0.1, contributeMax: false, overrideYears: [] },
      { id: "r3", accountId: "a1", annualAmount: 0, startYear: 2026, endYear: 2040, annualPercent: null, contributeMax: true, overrideYears: [] },
      // The override YEARS travel, as numbers; the AMOUNTS deliberately do not, so no rule can be
      // tempted to re-derive the engine's precedence from them. Note 2028's override is 0 — a year
      // key must survive on its own, never on its amount being truthy.
      { id: "r4", accountId: "a1", annualAmount: 9_000, startYear: 2026, endYear: 2040, annualPercent: null, contributeMax: false, overrideYears: [2027, 2028] },
    ]);
    expect(s.accounts).toEqual([{ id: "a1", name: "401(k)", category: "retirement", subType: "401k" }]);
    expect(s.deductions).toEqual([]);
  });

  it("defaults the optional tree collections rather than throwing on a sparse tree", () => {
    const sparse = { ...tree, entities: undefined, familyMembers: undefined, medicareCoverage: undefined } as unknown as ClientData;
    const s = snapshotFromTree(sparse, []);
    expect(s.entities).toEqual([]);
    expect(s.familyMembers).toEqual([]);
    expect(s.medicare).toEqual([]);
  });

  it("keeps an absent residence state and absent carryforwards as null, not undefined", () => {
    const bare = { ...tree, client: { ...tree.client, spouseDob: undefined }, planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.02 } } as unknown as ClientData;
    const s = snapshotFromTree(bare, []);
    expect(s.planSettings).toEqual({ planStartYear: 2026, planEndYear: 2060, inflationRate: 0.02, residenceState: null, capitalLossCarryforwardLt: null, capitalLossCarryforwardSt: null });
    expect(s.client.spouseDob).toBeNull();
  });
});
