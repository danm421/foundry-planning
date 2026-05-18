// src/lib/scenario/__tests__/loader-reinvestment.test.ts
//
// Regression test for the "reinvestment broken in non-base scenarios" bug.
//
// The engine `Reinvestment` type carries RESOLVED fields (newGrowthRate,
// newRealization, soldFractionByAccount). The scenario overlay merges the RAW
// form payload (modelPortfolioId / customGrowthRate / customPct*) without
// resolving it. Before the fix, a scenario-ADDED reinvestment reached
// `applyReinvestments` with no resolved fields → `acct.growthRate = undefined`
// and a TypeError on `soldFractionByAccount[acct.id]` for a taxed switch.
//
// `applyScenarioChangesWithRefs` must re-run `resolveReinvestments` over the
// effective tree's reinvestments so added / edited / unchanged reinvestments
// all carry correct resolved fields.

import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import { createGrowthSourceResolver } from "@/lib/projection/resolve-growth-source";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import type { ClientData, Reinvestment } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { AllocationMap } from "@/lib/projection/reinvestment-sold-fraction";

const assetClasses = [
  {
    id: "us-eq",
    geometricReturn: "0.08",
    pctOrdinaryIncome: "0.0",
    pctLtCapitalGains: "0.8",
    pctQualifiedDividends: "0.2",
    pctTaxExempt: "0.0",
  },
  {
    id: "bond",
    geometricReturn: "0.03",
    pctOrdinaryIncome: "1.0",
    pctLtCapitalGains: "0.0",
    pctQualifiedDividends: "0.0",
    pctTaxExempt: "0.0",
  },
  {
    id: "inflation",
    geometricReturn: "0.025",
    pctOrdinaryIncome: "0",
    pctLtCapitalGains: "0",
    pctQualifiedDividends: "0",
    pctTaxExempt: "0",
  },
] as const;

const planSettings = {
  growthSourceTaxable: "model_portfolio",
  modelPortfolioIdTaxable: "mp-aggressive",
  defaultGrowthTaxable: "0.05",
  growthSourceCash: "inflation",
  modelPortfolioIdCash: null,
  defaultGrowthCash: "0.02",
  growthSourceRetirement: "category_default",
  modelPortfolioIdRetirement: null,
  defaultGrowthRetirement: "0.06",
  defaultGrowthRealEstate: "0.04",
  defaultGrowthBusiness: "0.08",
  defaultGrowthLifeInsurance: "0.03",
  inflationAssetClassId: "inflation",
} as unknown as Parameters<typeof createGrowthSourceResolver>[0]["planSettings"];

function makeResolutionContext(): ResolutionContext {
  const resolver = createGrowthSourceResolver({
    planSettings,
    assetClasses,
    modelPortfolios: [{ id: "mp-aggressive" }, { id: "mp-conservative" }],
    modelPortfolioAllocations: [
      { portfolioId: "mp-aggressive", assetClassId: "us-eq", weight: "1.0" },
      { portfolioId: "mp-conservative", assetClassId: "us-eq", weight: "0.2" },
      { portfolioId: "mp-conservative", assetClassId: "bond", weight: "0.8" },
    ],
    accountAssetAllocations: [],
    clientCmaOverrides: [],
  });
  // The brokerage account is 100% equity before any reinvestment.
  const accountBaseAllocByAccountId = new Map<string, AllocationMap | undefined>([
    ["a-brokerage", new Map([["us-eq", 1.0]])],
  ]);
  return {
    resolver,
    resolvedInflationRate: 0.025,
    beneficiariesByAccountId: new Map(),
    policiesByAccount: {},
    ownersByAccountId: new Map(),
    accountBaseAllocByAccountId,
  };
}

function baseTree(): ClientData {
  return {
    client: { id: "c1", dateOfBirth: "1970-06-15", retirementAge: 60, planEndAge: 95 },
    planSettings: { planStartYear: 2025, planEndYear: 2065 },
    accounts: [{ id: "a-brokerage", category: "taxable" }],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
    reinvestments: [],
  } as unknown as ClientData;
}

/** A scenario `add` change carrying a RAW reinvestment payload — the shape the
 *  reinvestment form persists (`entity: {id, ...body}`). */
function addReinvestmentChange(): ScenarioChange {
  const rawPayload = {
    id: "ri-scenario",
    name: "Switch to Conservative 2035",
    accountIds: ["a-brokerage"],
    year: 2035,
    realizeTaxesOnSwitch: true,
    yearRef: null,
    targetType: "model_portfolio",
    modelPortfolioId: "mp-conservative",
    customGrowthRate: null,
    customPctOrdinaryIncome: null,
    customPctLtCapitalGains: null,
    customPctQualifiedDividends: null,
    customPctTaxExempt: null,
    // Resolved placeholders — the raw form payload would not even include
    // these; applyChanges merges whatever the writer stored.
    newGrowthRate: 0,
    soldFractionByAccount: {},
  };
  return {
    id: "ch1",
    scenarioId: "scn1",
    opType: "add",
    targetKind: "reinvestment",
    targetId: "ri-scenario",
    payload: rawPayload,
    toggleGroupId: null,
    orderIndex: 0,
  };
}

describe("applyScenarioChangesWithRefs — reinvestment re-resolution", () => {
  it("documents the gap: applyScenarioChanges alone leaves a scenario-added reinvestment unresolved", () => {
    // Without a resolutionContext, the reinvestment keeps its raw placeholder
    // resolved fields — newGrowthRate stays 0, soldFractionByAccount empty.
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [addReinvestmentChange()],
      {},
      [],
    );
    const ri = effectiveTree.reinvestments![0];
    expect(ri.newGrowthRate).toBe(0);
    expect(ri.soldFractionByAccount).toEqual({});
  });

  it("resolves a scenario-ADDED reinvestment: populated newGrowthRate, newRealization, soldFractionByAccount", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [addReinvestmentChange()],
      {},
      [],
      makeResolutionContext(),
    );
    expect(effectiveTree.reinvestments).toHaveLength(1);
    const ri = effectiveTree.reinvestments![0];
    // mp-conservative: 20% equity (0.08) + 80% bond (0.03) = 0.04.
    expect(ri.newGrowthRate).toBeCloseTo(0.04);
    expect(ri.newRealization).toBeDefined();
    expect(ri.newRealization!.pctOrdinaryIncome).toBeCloseTo(0.8);
    // Base 100% equity -> conservative 20% equity: sells 80% of the account.
    expect(ri.soldFractionByAccount["a-brokerage"]).toBeCloseTo(0.8);
    // It does NOT crash and the resolved fields are real numbers.
    expect(typeof ri.newGrowthRate).toBe("number");
  });

  it("resolves a scenario-EDITED reinvestment (raw-keyed diff) so the edit is not silently ignored", () => {
    const base = baseTree();
    // A base reinvestment targeting the aggressive portfolio.
    base.reinvestments = [
      {
        id: "ri-1",
        name: "Switch",
        accountIds: ["a-brokerage"],
        year: 2035,
        newGrowthRate: 0.08,
        newRealization: {
          pctOrdinaryIncome: 0,
          pctLtCapitalGains: 0.8,
          pctQualifiedDividends: 0.2,
          pctTaxExempt: 0,
          turnoverPct: 0,
        },
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: { "a-brokerage": 0 },
        yearRef: null,
        targetType: "model_portfolio",
        modelPortfolioId: "mp-aggressive",
        customGrowthRate: null,
        customPctOrdinaryIncome: null,
        customPctLtCapitalGains: null,
        customPctQualifiedDividends: null,
        customPctTaxExempt: null,
      } as Reinvestment,
    ];
    // Scenario edit: retarget to the conservative portfolio.
    const editChange: ScenarioChange = {
      id: "ch1",
      scenarioId: "scn1",
      opType: "edit",
      targetKind: "reinvestment",
      targetId: "ri-1",
      payload: {
        modelPortfolioId: { from: "mp-aggressive", to: "mp-conservative" },
      },
      toggleGroupId: null,
      orderIndex: 0,
    };
    const { effectiveTree } = applyScenarioChangesWithRefs(
      base,
      [editChange],
      {},
      [],
      makeResolutionContext(),
    );
    const ri = effectiveTree.reinvestments![0];
    // The edit must flow through to the resolved fields, not be ignored.
    expect(ri.modelPortfolioId).toBe("mp-conservative");
    expect(ri.newGrowthRate).toBeCloseTo(0.04);
    expect(ri.soldFractionByAccount["a-brokerage"]).toBeCloseTo(0.8);
  });

  it("leaves unchanged base reinvestments correct (idempotent re-resolution)", () => {
    const base = baseTree();
    base.reinvestments = [
      {
        id: "ri-1",
        name: "Switch",
        accountIds: ["a-brokerage"],
        year: 2035,
        newGrowthRate: 0.04,
        newRealization: {
          pctOrdinaryIncome: 0.8,
          pctLtCapitalGains: 0.16,
          pctQualifiedDividends: 0.04,
          pctTaxExempt: 0,
          turnoverPct: 0,
        },
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: { "a-brokerage": 0.8 },
        yearRef: null,
        targetType: "model_portfolio",
        modelPortfolioId: "mp-conservative",
        customGrowthRate: null,
        customPctOrdinaryIncome: null,
        customPctLtCapitalGains: null,
        customPctQualifiedDividends: null,
        customPctTaxExempt: null,
      } as Reinvestment,
    ];
    // An unrelated change (a different added reinvestment) still triggers a
    // full re-resolution pass; the untouched base reinvestment stays correct.
    const { effectiveTree } = applyScenarioChangesWithRefs(
      base,
      [],
      {},
      [],
      makeResolutionContext(),
    );
    const ri = effectiveTree.reinvestments![0];
    expect(ri.newGrowthRate).toBeCloseTo(0.04);
    expect(ri.soldFractionByAccount["a-brokerage"]).toBeCloseTo(0.8);
  });
});
