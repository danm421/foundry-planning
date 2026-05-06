import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { LEGACY_FM_CLIENT } from "../ownership";
import { buildClientData } from "./fixtures";
import { resolveAccountFromRaw } from "@/lib/projection/resolve-entity";
import { createGrowthSourceResolver } from "@/lib/projection/resolve-growth-source";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";

function makeCtx(): ResolutionContext {
  const resolver = createGrowthSourceResolver({
    planSettings: {
      growthSourceTaxable: "default",
      growthSourceCash: "default",
      growthSourceRetirement: "default",
      modelPortfolioIdTaxable: null,
      modelPortfolioIdCash: null,
      modelPortfolioIdRetirement: null,
      defaultGrowthTaxable: "0.07",
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
  });
  return {
    resolver,
    settings: {
      defaultGrowthRealEstate: "0.04",
      defaultGrowthBusiness: "0.05",
      defaultGrowthLifeInsurance: "0.03",
    },
    resolvedInflationRate: 0.025,
    beneficiariesByAccountId: new Map(),
    policiesByAccount: {},
    ownersByAccountId: new Map(),
    getCategoryGrowthSource: (category: string) => {
      const lookup: Record<string, string> = {
        taxable: "default",
        cash: "default",
        retirement: "default",
      };
      return lookup[category] ?? "custom";
    },
  };
}

describe("scenario-added account grows in projection", () => {
  it("an account added via the scenario resolver compounds year over year", () => {
    const baseTree = buildClientData();

    // Simulate what loader.ts does on an `add` change for an account: pass
    // the raw form payload (growthSource:"default", growthRate:null) through
    // the resolver. Pre-fix, the engine would see growthRate:null and produce
    // zero growth. Post-fix, the resolver fills in growthRate from the
    // category default (taxable → 0.07).
    const addedAccount = resolveAccountFromRaw(
      {
        id: "scenario-added-acct",
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
        priorYearEndValue: null,
        insuredPerson: null,
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
        ],
      },
      makeCtx(),
    );

    expect(typeof addedAccount.growthRate).toBe("number");
    expect(addedAccount.growthRate).toBeCloseTo(0.07);

    const treeWithAdd = {
      ...baseTree,
      accounts: [...baseTree.accounts, addedAccount],
    };
    const years = runProjection(treeWithAdd);

    const yr0 = years[0];
    const yr1 = years[1];
    const ledger0 = yr0.accountLedgers[addedAccount.id];
    const ledger1 = yr1.accountLedgers[addedAccount.id];

    expect(ledger0).toBeDefined();
    expect(ledger0.endingValue).toBeGreaterThan(100000);
    expect(ledger1.beginningValue).toBeCloseTo(ledger0.endingValue);
    expect(ledger1.growth).toBeGreaterThan(0);
  });

  it("same account with growthRate:null bypassing the resolver does NOT grow (reproduces the bug)", () => {
    const baseTree = buildClientData();

    // Construct what `applyScenarioChanges` saw before the fix: a raw form
    // payload with null growth shoved straight onto tree.accounts.
    const brokenAccount = {
      id: "broken-acct",
      name: "Broken Brokerage",
      category: "taxable" as const,
      subType: "individual",
      value: 100000,
      basis: 100000,
      // Engine reads this directly at projection.ts:824-828; null * value = 0.
      growthRate: null as unknown as number,
      rmdEnabled: false,
      owners: [
        { kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
      ],
    };

    const treeWithBroken = {
      ...baseTree,
      accounts: [...baseTree.accounts, brokenAccount],
    };
    const years = runProjection(treeWithBroken);
    const ledger0 = years[0].accountLedgers["broken-acct"];

    // No growth — the bug we're fixing.
    expect(ledger0.growth).toBe(0);
    expect(ledger0.endingValue).toBe(100000);
  });
});
