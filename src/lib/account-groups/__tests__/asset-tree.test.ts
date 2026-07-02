import { describe, it, expect } from "vitest";
import { buildAssetTree } from "../asset-tree";
import type { AssetAccount } from "@/components/account-groups/types";

const acct = (
  id: string,
  category: AssetAccount["category"],
  value: number,
): AssetAccount => ({ id, name: `acct-${id}`, category, value });

describe("buildAssetTree", () => {
  it("returns a single All Assets root with the full default hierarchy", () => {
    const [root] = buildAssetTree([]);
    expect(root.key).toBe("all-assets");
    expect(root.label).toBe("All Assets");
    expect(root.count).toBe(0);
    expect(root.value).toBe(0);
    // children: all-liquid + 6 illiquid leaves
    expect(root.children?.map((c) => c.key)).toEqual([
      "all-liquid",
      "annuity",
      "real_estate",
      "business",
      "life_insurance",
      "notes_receivable",
      "education_savings",
    ]);
    const liquid = root.children!.find((c) => c.key === "all-liquid")!;
    expect(liquid.children?.map((c) => c.key)).toEqual([
      "taxable",
      "retirement",
      "cash",
    ]);
  });

  it("aggregates counts and values, with children summing to each parent", () => {
    const [root] = buildAssetTree([
      acct("1", "taxable", 750_000),
      acct("2", "retirement", 720_000),
      acct("3", "cash", 0),
      acct("4", "real_estate", 500_000),
      acct("5", "business", 250_000),
    ]);
    expect(root.count).toBe(5);
    expect(root.value).toBe(2_220_000);

    const liquid = root.children!.find((c) => c.key === "all-liquid")!;
    expect(liquid.count).toBe(3);
    expect(liquid.value).toBe(1_470_000);

    const taxable = liquid.children!.find((c) => c.key === "taxable")!;
    expect(taxable.count).toBe(1);
    expect(taxable.value).toBe(750_000);

    const childSum = root.children!.reduce((s, c) => s + c.value, 0);
    expect(childSum).toBe(root.value);
  });

  it("attaches member accounts to leaf nodes only", () => {
    const [root] = buildAssetTree([acct("1", "business", 250_000)]);
    const business = root.children!.find((c) => c.key === "business")!;
    expect(business.accounts?.map((a) => a.id)).toEqual(["1"]);
    expect(business.children).toBeUndefined();
    // branch nodes carry children, not accounts
    expect(root.accounts).toBeUndefined();
    expect(root.children).toBeDefined();
  });

  it("keeps empty leaf groups present at 0 count / $0", () => {
    const [root] = buildAssetTree([]);
    const business = root.children!.find((c) => c.key === "business")!;
    expect(business.count).toBe(0);
    expect(business.value).toBe(0);
    expect(business.accounts).toEqual([]);
  });
});
