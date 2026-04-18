import { describe, it, expect } from "vitest";
import { resolveAccountAllocation, type AccountLite, type PlanSettingsLite } from "../allocation";

const PLAN: PlanSettingsLite = {
  growthSourceTaxable: "custom",
  growthSourceCash: "custom",
  growthSourceRetirement: "custom",
  modelPortfolioIdTaxable: null,
  modelPortfolioIdCash: null,
  modelPortfolioIdRetirement: null,
};

const P1_ALLOCATIONS = [
  { assetClassId: "ac-eq", weight: 0.6 },
  { assetClassId: "ac-bond", weight: 0.4 },
];

const ACCOUNT_MIX = {
  "acct-mix": [
    { assetClassId: "ac-eq", weight: 0.7 },
    { assetClassId: "ac-bond", weight: 0.3 },
  ],
};

const MP_ALLOCATIONS = { p1: P1_ALLOCATIONS };

function mkAccount(overrides: Partial<AccountLite>): AccountLite {
  return {
    id: "acct",
    category: "taxable",
    growthSource: "custom",
    modelPortfolioId: null,
    ...overrides,
  };
}

describe("resolveAccountAllocation", () => {
  it("uses explicit asset_mix rows when growthSource = 'asset_mix'", () => {
    const out = resolveAccountAllocation(
      mkAccount({ id: "acct-mix", growthSource: "asset_mix" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({
      classified: [
        { assetClassId: "ac-eq", weight: 0.7 },
        { assetClassId: "ac-bond", weight: 0.3 },
      ],
    });
  });

  it("returns unallocated when asset_mix is selected but rows are missing", () => {
    const out = resolveAccountAllocation(
      mkAccount({ id: "no-rows", growthSource: "asset_mix" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });

  it("follows the portfolio for growthSource = 'model_portfolio'", () => {
    const out = resolveAccountAllocation(
      mkAccount({ growthSource: "model_portfolio", modelPortfolioId: "p1" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ classified: P1_ALLOCATIONS });
  });

  it("returns unallocated when model_portfolio is selected with an unknown id", () => {
    const out = resolveAccountAllocation(
      mkAccount({ growthSource: "model_portfolio", modelPortfolioId: "nope" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });

  it("returns unallocated for a 'custom' account (no portfolio at account or plan level)", () => {
    const out = resolveAccountAllocation(
      mkAccount({ growthSource: "custom" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });

  it("falls back to plan_settings model portfolio for growthSource = 'default' when category's plan entry is a model portfolio", () => {
    const out = resolveAccountAllocation(
      mkAccount({ category: "retirement", growthSource: "default" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      { ...PLAN, growthSourceRetirement: "model_portfolio", modelPortfolioIdRetirement: "p1" },
    );
    expect(out).toEqual({ classified: P1_ALLOCATIONS });
  });

  it("returns unallocated for growthSource = 'default' when the plan entry is also 'custom'", () => {
    const out = resolveAccountAllocation(
      mkAccount({ category: "cash", growthSource: "default" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });
});
