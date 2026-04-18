import { describe, it, expect } from "vitest";
import {
  computeHouseholdAllocation,
  type AccountLite,
  type AccountAllocationResult,
  type InvestableAccount,
} from "../allocation";

const ASSET_CLASSES = [
  { id: "ac-eq", name: "US Equity", sortOrder: 0 },
  { id: "ac-bond", name: "US Bonds", sortOrder: 1 },
];

function mkAccount(
  id: string,
  category: AccountLite["category"],
  value: number,
  ownerEntityId: string | null = null,
): InvestableAccount {
  return { id, name: id, category, growthSource: "custom", modelPortfolioId: null, value, ownerEntityId };
}

describe("computeHouseholdAllocation", () => {
  it("rolls dollar-weighted resolved allocations across investable accounts", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("a2", "retirement", 300_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      return {
        classified: [
          { assetClassId: "ac-eq", weight: 0.5 },
          { assetClassId: "ac-bond", weight: 0.5 },
        ],
      };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    // a1 → 100k US Equity. a2 → 150k US Equity + 150k US Bonds.
    // Classified total = 400k. Equity 250k (62.5%), Bond 150k (37.5%).
    expect(out.totalInvestableValue).toBe(400_000);
    expect(out.totalClassifiedValue).toBe(400_000);
    expect(out.unallocatedValue).toBe(0);
    expect(out.excludedNonInvestableValue).toBe(0);
    expect(out.byAssetClass).toEqual([
      { id: "ac-eq", name: "US Equity", sortOrder: 0, value: 250_000, pctOfClassified: 0.625 },
      { id: "ac-bond", name: "US Bonds", sortOrder: 1, value: 150_000, pctOfClassified: 0.375 },
    ]);
  });

  it("puts unallocated dollars into the unallocated bucket, not byAssetClass", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("a2", "cash", 50_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      return { unallocated: true };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.totalInvestableValue).toBe(150_000);
    expect(out.totalClassifiedValue).toBe(100_000);
    expect(out.unallocatedValue).toBe(50_000);
    expect(out.byAssetClass).toEqual([
      { id: "ac-eq", name: "US Equity", sortOrder: 0, value: 100_000, pctOfClassified: 1 },
    ]);
  });

  it("excludes non-investable categories (business, real_estate, life_insurance) from the investable total", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("biz", "business", 500_000),
      mkAccount("home", "real_estate", 800_000),
      mkAccount("life", "life_insurance", 50_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.totalInvestableValue).toBe(100_000);
    expect(out.excludedNonInvestableValue).toBe(1_350_000);
  });

  it("excludes OOE (ownerEntityId set) accounts and counts them in excludedNonInvestableValue", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("trust-held", "taxable", 250_000, "entity-1"),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.totalInvestableValue).toBe(100_000);
    expect(out.excludedNonInvestableValue).toBe(250_000);
  });

  it("drops asset classes with zero rolled value from byAssetClass", () => {
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });
    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);
    // Only US Equity should appear; US Bonds has zero value.
    expect(out.byAssetClass.map((b) => b.id)).toEqual(["ac-eq"]);
  });

  it("sorts byAssetClass descending by value", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [
        { assetClassId: "ac-bond", weight: 0.7 },
        { assetClassId: "ac-eq", weight: 0.3 },
      ],
    });
    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);
    expect(out.byAssetClass.map((b) => b.id)).toEqual(["ac-bond", "ac-eq"]);
  });
});
