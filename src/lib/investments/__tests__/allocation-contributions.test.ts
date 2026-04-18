import { describe, it, expect } from "vitest";
import {
  computeHouseholdAllocation,
  type InvestableAccount,
  type AccountLite,
  type AccountAllocationResult,
} from "../allocation";

const ASSET_CLASSES = [
  { id: "ac-eq", name: "US Equity", sortOrder: 0 },
  { id: "ac-bond", name: "US Bonds", sortOrder: 1 },
];

function mkAccount(
  id: string,
  name: string,
  category: AccountLite["category"],
  value: number,
  ownerEntityId: string | null = null,
): InvestableAccount {
  return {
    id,
    name,
    category,
    growthSource: "custom",
    modelPortfolioId: null,
    value,
    ownerEntityId,
  };
}

describe("computeHouseholdAllocation contributions", () => {
  it("records per-account contributions keyed by asset class id", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("a2", "John 401(k)", "retirement", 300_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") {
        return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      }
      return {
        classified: [
          { assetClassId: "ac-eq", weight: 0.5 },
          { assetClassId: "ac-bond", weight: 0.5 },
        ],
      };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    // a1 -> 100k eq. a2 -> 150k eq + 150k bond. Sorted desc by valueInClass.
    expect(out.contributionsByAssetClass["ac-eq"]).toEqual([
      {
        accountId: "a2",
        accountName: "John 401(k)",
        accountValue: 300_000,
        valueInClass: 150_000,
        weightInClass: 0.5,
      },
      {
        accountId: "a1",
        accountName: "Joint Brokerage",
        accountValue: 100_000,
        valueInClass: 100_000,
        weightInClass: 1,
      },
    ]);
    expect(out.contributionsByAssetClass["ac-bond"]).toEqual([
      {
        accountId: "a2",
        accountName: "John 401(k)",
        accountValue: 300_000,
        valueInClass: 150_000,
        weightInClass: 0.5,
      },
    ]);
    expect(out.unallocatedContributions).toEqual([]);
  });

  it("sorts contributions descending by valueInClass", () => {
    const accounts = [
      mkAccount("a-small", "Small", "taxable", 10_000),
      mkAccount("a-big", "Big", "taxable", 500_000),
      mkAccount("a-mid", "Mid", "taxable", 100_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual([
      "a-big",
      "a-mid",
      "a-small",
    ]);
  });

  it("routes unresolvable accounts into unallocatedContributions with weightInClass=1", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("a2", "Opaque Account", "cash", 50_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") {
        return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      }
      return { unallocated: true };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.unallocatedContributions).toEqual([
      {
        accountId: "a2",
        accountName: "Opaque Account",
        accountValue: 50_000,
        valueInClass: 50_000,
        weightInClass: 1,
      },
    ]);
    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual(["a1"]);
  });

  it("excludes non-investable accounts from contributions entirely", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("biz", "LLC Equity", "business", 500_000),
      mkAccount("home", "Primary Home", "real_estate", 800_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual(["a1"]);
    expect(out.unallocatedContributions).toEqual([]);
  });

  it("excludes OOE accounts from contributions (counted only in excludedNonInvestableValue)", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("trust", "Trust Brokerage", "taxable", 250_000, "entity-1"),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual(["a1"]);
  });

  it("returns an empty contributions map when there are no investable accounts", () => {
    const out = computeHouseholdAllocation([], () => ({ unallocated: true }), ASSET_CLASSES);
    expect(out.contributionsByAssetClass).toEqual({});
    expect(out.unallocatedContributions).toEqual([]);
  });
});
