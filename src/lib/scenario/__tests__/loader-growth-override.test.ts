// src/lib/scenario/__tests__/loader-growth-override.test.ts
//
// Seam test for W9 inside `loadEffectiveTree`: a scenario whose ACTIVE
// plan_settings edits carry growth or inflation keys gets a second base load
// with those keys folded onto the raw settings, and that load — tree and
// resolution context — becomes the base for the scenario's changes. A scenario
// without such edits loads exactly once, as before.
//
// Mocked at the seam: the client-data load, the changes/groups queries and the
// scenario lookup. Everything downstream of them (applyScenarioChangesWithRefs,
// resolveAddPayload) is real.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import type { GrowthSettingsOverride } from "../growth-settings-override";
import { createGrowthSourceResolver } from "@/lib/projection/resolve-growth-source";

const { loadClientDataWithContext, loadScenarioChanges, loadScenarioToggleGroups } = vi.hoisted(
  () => ({
    loadClientDataWithContext: vi.fn(),
    loadScenarioChanges: vi.fn(),
    loadScenarioToggleGroups: vi.fn(),
  }),
);

vi.mock("@/lib/projection/load-client-data", () => ({ loadClientDataWithContext }));
vi.mock("../changes", () => ({ loadScenarioChanges, loadScenarioToggleGroups }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [{ id: "scn1", clientId: "c1", isBaseCase: false }],
      }),
    }),
  },
}));

import { loadEffectiveTree } from "../loader";

/** A context whose taxable category default is `taxableRate`, so an added
 *  default-sourced account shows which context resolved it. */
function makeCtx(taxableRate: string, resolvedInflationRate: number): ResolutionContext {
  return {
    resolver: createGrowthSourceResolver({
      planSettings: {
        growthSourceTaxable: "custom",
        growthSourceCash: "custom",
        growthSourceRetirement: "custom",
        growthSourceRealEstate: "custom",
        growthSourceBusiness: "custom",
        growthSourceLifeInsurance: "custom",
        modelPortfolioIdTaxable: null,
        modelPortfolioIdCash: null,
        modelPortfolioIdRetirement: null,
        defaultGrowthTaxable: taxableRate,
        defaultGrowthCash: "0.02",
        defaultGrowthRetirement: "0.06",
        defaultGrowthRealEstate: "0.04",
        defaultGrowthBusiness: "0.05",
        defaultGrowthLifeInsurance: "0.03",
        inflationAssetClassId: null,
      },
      assetClasses: [],
      modelPortfolios: [],
      modelPortfolioAllocations: [],
      accountAssetAllocations: [],
      clientCmaOverrides: [],
    }),
    resolvedInflationRate,
    beneficiariesByAccountId: new Map(),
    policiesByAccount: {},
    ownersByAccountId: new Map(),
  };
}

/** A loaded tree whose taxable default is `taxableRate`: its view-only
 *  `defaultGrowthTaxable` and its default-sourced base brokerage account both
 *  carry it, so a test can tell which load the scenario was built on. */
function makeTree(taxableRate: number): ClientData {
  return {
    client: { dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 95, lifeExpectancy: 90 },
    planSettings: {
      planStartYear: 2026,
      planEndYear: 2060,
      inflationRate: 0.025,
      flatStateRate: 0.05,
      defaultGrowthTaxable: taxableRate,
    },
    accounts: [
      { id: "base-brokerage", name: "Base Brokerage", category: "taxable", growthRate: taxableRate, owners: [] },
    ],
    incomes: [],
    expenses: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
    reinvestments: [],
  } as unknown as ClientData;
}

// Base: a 2.5% asset-class inflation rate, 7% taxable default. The override
// load stands in for what `loadClientData` resolves under the scenario's
// settings: 9% taxable default, and — the source still being "asset_class" —
// the same 2.5% resolved inflation, whatever raw rate the scenario typed.
const baseCtx = makeCtx("0.07", 0.025);
const overrideCtx = makeCtx("0.09", 0.025);
const baseTree = makeTree(0.07);
const overrideTree = makeTree(0.09);
const baseBrokerageGrowth = (tree: ClientData) =>
  tree.accounts.find((a) => a.id === "base-brokerage")!.growthRate;

const planSettingsEdit = (
  payload: Record<string, unknown>,
  toggleGroupId: string | null = null,
): ScenarioChange => ({
  id: "ps1",
  scenarioId: "scn1",
  opType: "edit",
  targetKind: "plan_settings",
  targetId: "c1",
  payload: Object.fromEntries(Object.entries(payload).map(([k, to]) => [k, { from: null, to }])),
  toggleGroupId,
  orderIndex: 0,
});

const addTaxableAccount: ScenarioChange = {
  id: "add1",
  scenarioId: "scn1",
  opType: "add",
  targetKind: "account",
  targetId: "added-1",
  payload: {
    id: "added-1",
    name: "Scenario Brokerage",
    category: "taxable",
    subType: "individual",
    value: "100000",
    basis: "100000",
    growthSource: "default",
    growthRate: null,
    turnoverPct: "0",
    annualPropertyTax: "0",
    propertyTaxGrowthRate: "0",
    rmdEnabled: false,
    isDefaultChecking: false,
    modelPortfolioId: null,
    overridePctOi: null,
    overridePctLtCg: null,
    overridePctQdiv: null,
    overridePctTaxExempt: null,
  },
  toggleGroupId: null,
  orderIndex: 1,
};

function seed(changes: ScenarioChange[], groups: ToggleGroup[] = []) {
  loadScenarioChanges.mockResolvedValue(changes);
  loadScenarioToggleGroups.mockResolvedValue(groups);
}

describe("loadEffectiveTree — per-scenario growth & inflation override", () => {
  beforeEach(() => {
    loadClientDataWithContext.mockReset();
    loadClientDataWithContext.mockImplementation(
      async (_clientId: string, _firmId: string, opts?: { planSettingsOverride?: GrowthSettingsOverride }) =>
        opts?.planSettingsOverride
          ? { clientData: structuredClone(overrideTree), resolutionContext: overrideCtx }
          : { clientData: structuredClone(baseTree), resolutionContext: baseCtx },
    );
  });

  it("loads once, on the base, when no edit carries a growth key", async () => {
    seed([planSettingsEdit({ flatStateRate: 0.06 }), addTaxableAccount]);

    const { effectiveTree, resolutionContext } = await loadEffectiveTree("c1", "f1", "scn1", {});

    expect(loadClientDataWithContext).toHaveBeenCalledTimes(1);
    expect(loadClientDataWithContext).toHaveBeenCalledWith("c1", "f1");
    expect(resolutionContext).toBe(baseCtx);
    expect(effectiveTree.planSettings.flatStateRate).toBe(0.06);
    expect(effectiveTree.accounts.find((a) => a.id === "added-1")!.growthRate).toBeCloseTo(0.07, 10);
    expect(baseBrokerageGrowth(effectiveTree)).toBe(0.07);
    expect(effectiveTree.planSettings.defaultGrowthTaxable).toBe(0.07);
  });

  it("loads the base and an override, and builds the scenario on the override", async () => {
    seed([
      planSettingsEdit({ defaultGrowthTaxable: 0.09, inflationRate: 0.05, flatStateRate: 0.06 }),
      addTaxableAccount,
    ]);

    const { effectiveTree, resolutionContext } = await loadEffectiveTree("c1", "f1", "scn1", {});

    expect(loadClientDataWithContext).toHaveBeenCalledTimes(2);
    expect(loadClientDataWithContext).toHaveBeenNthCalledWith(1, "c1", "f1");
    expect(loadClientDataWithContext).toHaveBeenNthCalledWith(2, "c1", "f1", {
      planSettingsOverride: { defaultGrowthTaxable: 0.09, inflationRate: 0.05 },
    });
    expect(resolutionContext).toBe(overrideCtx);
    // The scenario is built on the OVERRIDE tree: its base rows carry the
    // override load's resolved growth, and its settings the override's values.
    expect(baseBrokerageGrowth(effectiveTree)).toBe(0.09);
    expect(effectiveTree.planSettings.defaultGrowthTaxable).toBe(0.09);
    // An added account resolves against the scenario's growth defaults.
    expect(effectiveTree.accounts.find((a) => a.id === "added-1")!.growthRate).toBeCloseTo(0.09, 10);
    // Growth keys are stripped before the overlay: the raw 5% never overwrites
    // the override load's resolved rate. Non-growth keys still apply.
    expect(effectiveTree.planSettings.inflationRate).toBe(0.025);
    expect(effectiveTree.planSettings.flatStateRate).toBe(0.06);
  });

  it("ignores a growth edit inside a switched-off group", async () => {
    const groups: ToggleGroup[] = [
      { id: "g1", scenarioId: "scn1", name: "Growth", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
    ];
    seed([planSettingsEdit({ defaultGrowthTaxable: 0.09 }, "g1"), addTaxableAccount], groups);

    const { resolutionContext, effectiveTree } = await loadEffectiveTree("c1", "f1", "scn1", { g1: false });

    expect(loadClientDataWithContext).toHaveBeenCalledTimes(1);
    expect(resolutionContext).toBe(baseCtx);
    expect(effectiveTree.accounts.find((a) => a.id === "added-1")!.growthRate).toBeCloseTo(0.07, 10);
    expect(baseBrokerageGrowth(effectiveTree)).toBe(0.07);
  });
});
