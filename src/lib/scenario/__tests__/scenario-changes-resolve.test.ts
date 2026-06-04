import { describe, it, expect } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import {
  buildBaseResolveData,
  buildAssetTxResolveData,
  buildReinvestmentEnrichmentDeps,
  hasReinvestmentChange,
  applyReinvestmentEnrichment,
  type ReinvestmentEnrichmentDeps,
} from "../scenario-changes-resolve";
import type { Reinvestment } from "@/engine/types";

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

describe("buildAssetTxResolveData", () => {
  // Only the fields buildAssetTxResolveData reads are populated; cast keeps the
  // fixture terse.
  const years = [
    {
      year: 2030,
      techniqueBreakdown: {
        sales: [],
        purchases: [
          { transactionId: "buy-1", name: "Rental", purchasePrice: 600000, mortgageAmount: 400000, equity: 200000 },
        ],
      },
    },
    {
      year: 2035,
      techniqueBreakdown: {
        sales: [
          { transactionId: "sell-1", name: "Rental", saleValue: 650000, transactionCosts: 40000, mortgagePaidOff: 0, netProceeds: 610000, capitalGain: 300000 },
        ],
        purchases: [],
      },
    },
    { year: 2040 }, // no techniqueBreakdown
  ] as unknown as ProjectionYear[];

  it("maps sell breakdown by transaction id", () => {
    const m = buildAssetTxResolveData(years);
    expect(m["sell-1"]).toMatchObject({
      type: "sell", saleValue: 650000, netProceeds: 610000,
      capitalGain: 300000, transactionCosts: 40000, mortgagePaidOff: 0,
    });
  });

  it("maps buy breakdown by transaction id", () => {
    const m = buildAssetTxResolveData(years);
    expect(m["buy-1"]).toMatchObject({
      type: "buy", purchasePrice: 600000, mortgageAmount: 400000, equity: 200000,
    });
  });

  it("skips years with no techniqueBreakdown and returns {} when none execute", () => {
    expect(buildAssetTxResolveData([{ year: 2041 } as unknown as ProjectionYear])).toEqual({});
  });
});

describe("buildReinvestmentEnrichmentDeps", () => {
  const reinvestments = [
    { id: "ri-1", modelPortfolioId: "mp-1", newGrowthRate: 0.072, accountIds: [], year: 2030 },
    { id: "ri-2", modelPortfolioId: null, newGrowthRate: 0.05, accountIds: [], year: 2031 },
  ] as unknown as Reinvestment[];

  it("maps name (catalog) + resolved rate (effective tree) for referenced portfolios", () => {
    const deps = buildReinvestmentEnrichmentDeps(
      [change({ targetKind: "reinvestment", payload: { modelPortfolioId: "mp-1" } })],
      { "mp-1": "Aggressive (100/0)", "mp-9": "Unreferenced" },
      reinvestments,
    );
    expect(deps.modelPortfolioNamesById).toEqual({ "mp-1": "Aggressive (100/0)" });
    expect(deps.modelPortfolioRatesById).toEqual({ "mp-1": 0.072 });
    // Base-allocation maps are intentionally left empty.
    expect(deps.baseAllocationMixById).toEqual({});
    expect(deps.baseAllocationBlendedRateById).toEqual({});
  });

  it("ignores non-reinvestment changes and payloads without a model portfolio id", () => {
    const deps = buildReinvestmentEnrichmentDeps(
      [
        change({ targetKind: "income", payload: { modelPortfolioId: "mp-1" } }),
        change({ targetKind: "reinvestment", payload: { modelPortfolioId: null } }),
      ],
      { "mp-1": "Aggressive (100/0)" },
      reinvestments,
    );
    expect(deps.modelPortfolioNamesById).toEqual({});
    expect(deps.modelPortfolioRatesById).toEqual({});
  });

  it("omits the rate when the effective tree has no resolved reinvestment for the portfolio", () => {
    const deps = buildReinvestmentEnrichmentDeps(
      [change({ targetKind: "reinvestment", payload: { modelPortfolioId: "mp-7" } })],
      { "mp-7": "Conservative (40/60)" },
      reinvestments,
    );
    expect(deps.modelPortfolioNamesById).toEqual({ "mp-7": "Conservative (40/60)" });
    expect(deps.modelPortfolioRatesById).toEqual({}); // applyReinvestmentEnrichment defaults it to 0
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
