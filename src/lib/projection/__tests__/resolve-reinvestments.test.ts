import { describe, it, expect } from "vitest";
import { createGrowthSourceResolver } from "../resolve-growth-source";
import { resolveReinvestments } from "../resolve-reinvestments";
import type { Reinvestment } from "@/engine/types";
import type { AllocationMap } from "../reinvestment-sold-fraction";

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

// mp-aggressive: 100% equity. mp-conservative: 20/80 equity/bond.
const modelPortfolioAllocations = [
  { portfolioId: "mp-aggressive", assetClassId: "us-eq", weight: "1.0" },
  { portfolioId: "mp-conservative", assetClassId: "us-eq", weight: "0.2" },
  { portfolioId: "mp-conservative", assetClassId: "bond", weight: "0.8" },
];

function makeResolver() {
  return createGrowthSourceResolver({
    planSettings,
    assetClasses,
    modelPortfolios: [{ id: "mp-aggressive" }, { id: "mp-conservative" }],
    modelPortfolioAllocations,
    accountAssetAllocations: [],
    clientCmaOverrides: [],
  });
}

/** A raw-shaped reinvestment carrying the resolution inputs but with empty
 *  resolved fields — exactly what a scenario `add` payload looks like. */
function rawReinvestment(overrides: Partial<Reinvestment>): Reinvestment {
  return {
    id: "ri-1",
    name: "Switch",
    accountIds: ["acct-1"],
    year: 2035,
    newGrowthRate: 0,
    newRealization: undefined,
    realizeTaxesOnSwitch: false,
    soldFractionByAccount: {},
    yearRef: null,
    targetType: "model_portfolio",
    modelPortfolioId: "mp-conservative",
    customGrowthRate: null,
    customPctOrdinaryIncome: null,
    customPctLtCapitalGains: null,
    customPctQualifiedDividends: null,
    customPctTaxExempt: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resolveReinvestments", () => {
  it("resolves a model-portfolio target into newGrowthRate + newRealization", () => {
    const resolver = makeResolver();
    const [resolved] = resolveReinvestments([rawReinvestment({})], {
      resolver,
      accountBaseAllocByAccountId: new Map(),
    });
    // mp-conservative: 20% equity (0.08) + 80% bond (0.03) = 0.04
    expect(resolved.newGrowthRate).toBeCloseTo(0.04);
    expect(resolved.newRealization).toBeDefined();
    // 20% equity OI(0) + 80% bond OI(1) = 0.8
    expect(resolved.newRealization!.pctOrdinaryIncome).toBeCloseTo(0.8);
    expect(resolved.newRealization!.pctLtCapitalGains).toBeCloseTo(0.16);
  });

  it("resolves a custom target from the raw customGrowthRate / customPct* fields", () => {
    const resolver = makeResolver();
    const [resolved] = resolveReinvestments(
      [
        rawReinvestment({
          targetType: "custom",
          modelPortfolioId: null,
          customGrowthRate: 0.055,
          customPctOrdinaryIncome: 0.3,
          customPctLtCapitalGains: 0.5,
          customPctQualifiedDividends: 0.15,
          customPctTaxExempt: 0.05,
        }),
      ],
      { resolver, accountBaseAllocByAccountId: new Map() },
    );
    expect(resolved.newGrowthRate).toBeCloseTo(0.055);
    expect(resolved.newRealization!.pctOrdinaryIncome).toBeCloseTo(0.3);
    expect(resolved.newRealization!.pctLtCapitalGains).toBeCloseTo(0.5);
    expect(resolved.newRealization!.pctQualifiedDividends).toBeCloseTo(0.15);
    expect(resolved.newRealization!.pctTaxExempt).toBeCloseTo(0.05);
  });

  it("coerces decimal-string raw custom inputs to numbers", () => {
    const resolver = makeResolver();
    const [resolved] = resolveReinvestments(
      [
        rawReinvestment({
          targetType: "custom",
          modelPortfolioId: null,
          customGrowthRate: "0.045" as unknown as number,
        }),
      ],
      { resolver, accountBaseAllocByAccountId: new Map() },
    );
    expect(resolved.newGrowthRate).toBeCloseTo(0.045);
  });

  it("computes soldFractionByAccount from the account base allocation", () => {
    const resolver = makeResolver();
    // Account base allocation: 100% equity (an aggressive account).
    const accountBase: AllocationMap = new Map([["us-eq", 1.0]]);
    const [resolved] = resolveReinvestments([rawReinvestment({})], {
      resolver,
      accountBaseAllocByAccountId: new Map([["acct-1", accountBase]]),
    });
    // Base 100% equity -> mp-conservative 20% equity: sells 80% of equity.
    expect(resolved.soldFractionByAccount["acct-1"]).toBeCloseTo(0.8);
  });

  it("chains soldFraction across multiple reinvestments on the same account in year order", () => {
    const resolver = makeResolver();
    const accountBase: AllocationMap = new Map([["us-eq", 1.0]]);
    // ri-late switches to aggressive (100% eq); ri-early to conservative.
    const riEarly = rawReinvestment({ id: "ri-early", year: 2030 });
    const riLate = rawReinvestment({
      id: "ri-late",
      year: 2040,
      modelPortfolioId: "mp-aggressive",
    });
    const resolved = resolveReinvestments([riLate, riEarly], {
      resolver,
      accountBaseAllocByAccountId: new Map([["acct-1", accountBase]]),
    });
    const early = resolved.find((r) => r.id === "ri-early")!;
    const late = resolved.find((r) => r.id === "ri-late")!;
    // 2030: 100% eq -> conservative (20% eq): sells 0.8.
    expect(early.soldFractionByAccount["acct-1"]).toBeCloseTo(0.8);
    // 2040: conservative (20% eq, 80% bond) -> aggressive (100% eq):
    //   sells the 0.8 bond position.
    expect(late.soldFractionByAccount["acct-1"]).toBeCloseTo(0.8);
  });

  it("is idempotent — re-resolving an already-resolved entry yields the same result", () => {
    const resolver = makeResolver();
    const accountBase: AllocationMap = new Map([["us-eq", 1.0]]);
    const ctx = {
      resolver,
      accountBaseAllocByAccountId: new Map([["acct-1", accountBase]]),
    };
    const once = resolveReinvestments([rawReinvestment({})], ctx);
    const twice = resolveReinvestments(once, ctx);
    expect(twice).toEqual(once);
  });

  it("does not mutate the input entries", () => {
    const resolver = makeResolver();
    const input = rawReinvestment({});
    resolveReinvestments([input], {
      resolver,
      accountBaseAllocByAccountId: new Map(),
    });
    expect(input.newGrowthRate).toBe(0);
    expect(input.soldFractionByAccount).toEqual({});
  });
});
