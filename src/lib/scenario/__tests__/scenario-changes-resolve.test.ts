import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import {
  buildBaseResolveData,
  hasReinvestmentChange,
  applyReinvestmentEnrichment,
  type ReinvestmentEnrichmentDeps,
} from "../scenario-changes-resolve";

/** Minimal ClientData fixture exercising every collection buildBaseResolveData reads. */
function fixtureTree(overrides: Partial<ClientData> = {}): ClientData {
  return {
    client: {
      firstName: "John",
      lastName: "Smith",
      dateOfBirth: "1960-01-01",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
      spouseName: "Jane",
    },
    accounts: [
      // Cast keeps the fixture terse — buildBaseResolveData reads only id/name/category/subType.
      { id: "acc-1", name: "Joint Brokerage", category: "taxable", subType: "brokerage" },
      { id: "acc-2", name: "His 401(k)", category: "retirement", subType: "401k" },
    ] as ClientData["accounts"],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0.025,
      planStartYear: 2025,
      planEndYear: 2055,
    },
    giftEvents: [],
    familyMembers: [
      { id: "fm-1", firstName: "Amy", lastName: "Smith" },
      { id: "fm-2", firstName: "Cher", lastName: null },
    ] as ClientData["familyMembers"],
    externalBeneficiaries: [
      { id: "eb-1", name: "Red Cross", kind: "charity", charityType: "public" },
    ],
    entities: [
      { id: "ent-1", name: "Family Trust", includeInPortfolio: false, isGrantor: true },
      // No name → must be skipped.
      { id: "ent-2", includeInPortfolio: false, isGrantor: false },
    ] as ClientData["entities"],
    ...overrides,
  };
}

function change(partial: Partial<ScenarioChange>): ScenarioChange {
  return {
    id: "c1",
    scenarioId: "s1",
    opType: "add",
    targetKind: "income",
    targetId: "t1",
    payload: null,
    toggleGroupId: null,
    orderIndex: 0,
    ...partial,
  };
}

describe("buildBaseResolveData", () => {
  it("maps accounts by id with name/category/subType", () => {
    const r = buildBaseResolveData(fixtureTree());
    expect(r.accountsById["acc-1"]).toEqual({
      name: "Joint Brokerage",
      category: "taxable",
      subType: "brokerage",
    });
    expect(r.accountsById["acc-2"].name).toBe("His 401(k)");
  });

  it("keys family members under family_member: and joins first+last name", () => {
    const r = buildBaseResolveData(fixtureTree());
    expect(r.recipientsById["family_member:fm-1"]).toBe("Amy Smith");
    // Null last name → first name only, no trailing space.
    expect(r.recipientsById["family_member:fm-2"]).toBe("Cher");
  });

  it("keys external beneficiaries under external_beneficiary:", () => {
    const r = buildBaseResolveData(fixtureTree());
    expect(r.recipientsById["external_beneficiary:eb-1"]).toBe("Red Cross");
  });

  it("maps named entities into entitiesById AND recipientsById; skips unnamed", () => {
    const r = buildBaseResolveData(fixtureTree());
    expect(r.entitiesById["ent-1"]).toBe("Family Trust");
    expect(r.recipientsById["entity:ent-1"]).toBe("Family Trust");
    expect(r.entitiesById["ent-2"]).toBeUndefined();
    expect(r.recipientsById["entity:ent-2"]).toBeUndefined();
  });

  it("reads spouse name from client.spouseName", () => {
    expect(buildBaseResolveData(fixtureTree()).spouseName).toBe("Jane");
  });

  it("leaves reinvestment maps empty (base path)", () => {
    const r = buildBaseResolveData(fixtureTree());
    expect(r.modelPortfoliosById).toEqual({});
    expect(r.baseAllocationsById).toEqual({});
  });

  it("is robust to missing optional collections", () => {
    const tree = fixtureTree({
      familyMembers: undefined,
      externalBeneficiaries: undefined,
      entities: undefined,
      client: {
        firstName: "Solo",
        lastName: "Person",
        dateOfBirth: "1970-01-01",
        retirementAge: 65,
        planEndAge: 95,
        filingStatus: "single",
        // no spouseName
      },
    });
    const r = buildBaseResolveData(tree);
    expect(r.recipientsById).toEqual({});
    expect(r.entitiesById).toEqual({});
    expect(r.spouseName).toBeNull();
    expect(Object.keys(r.accountsById)).toHaveLength(2);
  });
});

describe("hasReinvestmentChange", () => {
  it("is true when any change targets a reinvestment", () => {
    expect(
      hasReinvestmentChange([
        change({ targetKind: "income" }),
        change({ targetKind: "reinvestment" }),
      ]),
    ).toBe(true);
  });

  it("is false otherwise", () => {
    expect(
      hasReinvestmentChange([
        change({ targetKind: "income" }),
        change({ targetKind: "transfer" }),
      ]),
    ).toBe(false);
  });

  it("is false for an empty change set", () => {
    expect(hasReinvestmentChange([])).toBe(false);
  });
});

describe("applyReinvestmentEnrichment", () => {
  const base = buildBaseResolveData(fixtureTree());

  it("maps model portfolio names + rates by portfolio id", () => {
    const deps: ReinvestmentEnrichmentDeps = {
      modelPortfolioNamesById: { "mp-1": "Growth 80/20" },
      modelPortfolioRatesById: { "mp-1": 0.072 },
      baseAllocationMixById: {},
      baseAllocationBlendedRateById: {},
    };
    const r = applyReinvestmentEnrichment(base, deps);
    expect(r.modelPortfoliosById["mp-1"]).toEqual({ name: "Growth 80/20", rate: 0.072 });
  });

  it("defaults a missing portfolio rate to 0", () => {
    const r = applyReinvestmentEnrichment(base, {
      modelPortfolioNamesById: { "mp-9": "No Rate" },
      modelPortfolioRatesById: {},
      baseAllocationMixById: {},
      baseAllocationBlendedRateById: {},
    });
    expect(r.modelPortfoliosById["mp-9"]).toEqual({ name: "No Rate", rate: 0 });
  });

  it("maps base allocations by account id (mix + blended rate)", () => {
    const r = applyReinvestmentEnrichment(base, {
      modelPortfolioNamesById: {},
      modelPortfolioRatesById: {},
      baseAllocationMixById: { "acc-1": "70/30 stock/bond" },
      baseAllocationBlendedRateById: { "acc-1": 0.061 },
    });
    expect(r.baseAllocationsById["acc-1"]).toEqual({
      mix: "70/30 stock/bond",
      blendedRate: 0.061,
    });
  });

  it("degrades to blended-rate-only when the mix label is absent", () => {
    const r = applyReinvestmentEnrichment(base, {
      modelPortfolioNamesById: {},
      modelPortfolioRatesById: {},
      baseAllocationMixById: {},
      baseAllocationBlendedRateById: { "acc-2": 0.05 },
    });
    expect(r.baseAllocationsById["acc-2"]).toEqual({ mix: "", blendedRate: 0.05 });
  });

  it("preserves the base maps (does not mutate input)", () => {
    const r = applyReinvestmentEnrichment(base, {
      modelPortfolioNamesById: {},
      modelPortfolioRatesById: {},
      baseAllocationMixById: {},
      baseAllocationBlendedRateById: {},
    });
    expect(r.accountsById).toBe(base.accountsById);
    expect(r.recipientsById["entity:ent-1"]).toBe("Family Trust");
    expect(base.modelPortfoliosById).toEqual({});
  });
});
