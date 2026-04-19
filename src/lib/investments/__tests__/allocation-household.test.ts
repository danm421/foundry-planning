import { describe, it, expect } from "vitest";
import {
  computeHouseholdAllocation,
  type AccountLite,
  type AccountAllocationResult,
  type InvestableAccount,
} from "../allocation";

const ASSET_CLASSES = [
  { id: "ac-eq",   name: "US Equity", sortOrder: 0, assetType: "equities" as const },
  { id: "ac-bond", name: "US Bonds",  sortOrder: 1, assetType: "taxable_bonds" as const },
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
      { id: "ac-eq",   name: "US Equity", sortOrder: 0, value: 250_000, pctOfClassified: 0.625, assetType: "equities" },
      { id: "ac-bond", name: "US Bonds",  sortOrder: 1, value: 150_000, pctOfClassified: 0.375, assetType: "taxable_bonds" },
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
      { id: "ac-eq", name: "US Equity", sortOrder: 0, value: 100_000, pctOfClassified: 1, assetType: "equities" },
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

  it("rolls byAssetClass entries up into byAssetType using each class's assetType", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "US Equity", sortOrder: 0, assetType: "equities" as const },
      { id: "ac-bond", name: "US Bonds",  sortOrder: 1, assetType: "taxable_bonds" as const },
      { id: "ac-muni", name: "Muni",      sortOrder: 2, assetType: "tax_exempt_bonds" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [
        { assetClassId: "ac-eq",   weight: 0.6 },
        { assetClassId: "ac-bond", weight: 0.3 },
        { assetClassId: "ac-muni", weight: 0.1 },
      ],
    });

    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);

    expect(out.byAssetType.map((t) => t.id)).toEqual(["equities", "taxable_bonds", "tax_exempt_bonds"]);
    expect(out.byAssetType.find((t) => t.id === "equities")?.value).toBeCloseTo(60_000);
    expect(out.byAssetType.find((t) => t.id === "taxable_bonds")?.value).toBeCloseTo(30_000);
    expect(out.byAssetType.find((t) => t.id === "tax_exempt_bonds")?.value).toBeCloseTo(10_000);
  });

  it("byAssetType is ordered by ASSET_TYPE_SORT_ORDER even when value order would differ", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-cash", name: "Cash", sortOrder: 1, assetType: "cash" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      // 90% cash, 10% equity — value order is cash > equity, sort order is equity < cash
      classified: [
        { assetClassId: "ac-cash", weight: 0.9 },
        { assetClassId: "ac-eq",   weight: 0.1 },
      ],
    });

    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);

    expect(out.byAssetType.map((t) => t.id)).toEqual(["equities", "cash"]);
  });

  it("byAssetType pctOfClassified sums (roughly) to 1.0 when there is no unallocated", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-bond", name: "Bond", sortOrder: 1, assetType: "taxable_bonds" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [
        { assetClassId: "ac-eq",   weight: 0.4 },
        { assetClassId: "ac-bond", weight: 0.6 },
      ],
    });
    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);
    const sum = out.byAssetType.reduce((a, t) => a + t.pctOfClassified, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("contributionsByAssetType groups class contributions under their type", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-bond", name: "Bond", sortOrder: 1, assetType: "taxable_bonds" as const },
    ];
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("a2", "retirement", 200_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      return {
        classified: [
          { assetClassId: "ac-eq",   weight: 0.5 },
          { assetClassId: "ac-bond", weight: 0.5 },
        ],
      };
    };

    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);

    // equities type: ac-eq appears once with BOTH accounts as contributions
    const eqGroup = out.contributionsByAssetType.equities;
    expect(eqGroup).toHaveLength(1);
    expect(eqGroup![0]!.assetClassId).toBe("ac-eq");
    expect(eqGroup![0]!.assetClassName).toBe("Eq");
    expect(eqGroup![0]!.subtotal).toBeCloseTo(200_000); // 100k + 100k
    expect(eqGroup![0]!.contributions.map((c) => c.accountId).sort()).toEqual(["a1", "a2"]);

    const bondGroup = out.contributionsByAssetType.taxable_bonds;
    expect(bondGroup).toHaveLength(1);
    expect(bondGroup![0]!.subtotal).toBeCloseTo(100_000);
  });

  it("byAssetType omits types with zero value", () => {
    const assetClasses = [
      { id: "ac-eq",   name: "Eq",   sortOrder: 0, assetType: "equities" as const },
      { id: "ac-cash", name: "Cash", sortOrder: 1, assetType: "cash" as const },
    ];
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });
    const out = computeHouseholdAllocation(accounts, resolver, assetClasses);
    expect(out.byAssetType.map((t) => t.id)).toEqual(["equities"]);
  });
});
