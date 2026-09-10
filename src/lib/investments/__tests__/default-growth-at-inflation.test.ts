import { describe, it, expect } from "vitest";
import {
  detectDefaultGrowthAtInflation,
  detectDefaultGrowthAtInflationFor,
} from "../default-growth-at-inflation";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";

const acct = (
  category: string,
  value: number,
  growthSource?: string | null,
) => ({ category, value, growthSource });

describe("detectDefaultGrowthAtInflation", () => {
  it("flags taxable and retirement accounts inheriting an untouched inflation default", () => {
    const result = detectDefaultGrowthAtInflation({
      accounts: [
        acct("taxable", 1_000_000, "default"),
        acct("retirement", 500_000, null),
      ],
      categorySources: { taxable: "inflation", retirement: "inflation" },
      categoryRate: () => 0.025,
    });

    expect(result).toEqual({
      categories: ["taxable", "retirement"],
      accountCount: 2,
      totalValue: 1_500_000,
      rate: 0.025,
    });
  });

  it("returns null when the plan default is a real return assumption", () => {
    expect(
      detectDefaultGrowthAtInflation({
        accounts: [acct("taxable", 1_000_000, "default")],
        categorySources: { taxable: "model_portfolio", retirement: "custom" },
        categoryRate: () => 0.025,
      }),
    ).toBeNull();
  });

  it("returns null when every account overrides the default itself", () => {
    expect(
      detectDefaultGrowthAtInflation({
        accounts: [
          acct("taxable", 1_000_000, "model_portfolio"),
          acct("retirement", 500_000, "custom"),
          // An explicit per-account "inflation" is the advisor's own choice.
          acct("taxable", 200_000, "inflation"),
        ],
        categorySources: { taxable: "inflation", retirement: "inflation" },
        categoryRate: () => 0.025,
      }),
    ).toBeNull();
  });

  it("counts only the stuck category when the other one is set", () => {
    const result = detectDefaultGrowthAtInflation({
      accounts: [
        acct("taxable", 1_000_000, "default"),
        acct("retirement", 500_000, "default"),
      ],
      categorySources: { taxable: "model_portfolio", retirement: "inflation" },
      categoryRate: () => 0.03,
    });

    expect(result).toMatchObject({
      categories: ["retirement"],
      accountCount: 1,
      totalValue: 500_000,
    });
  });

  it("ignores categories outside taxable and retirement", () => {
    expect(
      detectDefaultGrowthAtInflation({
        accounts: [
          acct("cash", 1_000_000, "default"),
          acct("real_estate", 800_000, "default"),
          acct("education_savings", 50_000, "default"),
          acct("annuity", 90_000, "default"),
        ],
        categorySources: { taxable: "inflation", retirement: "inflation" },
        categoryRate: () => 0.025,
      }),
    ).toBeNull();
  });

  it("returns null when a stuck category holds no accounts", () => {
    expect(
      detectDefaultGrowthAtInflation({
        accounts: [],
        categorySources: { taxable: "inflation", retirement: "inflation" },
        categoryRate: () => 0.025,
      }),
    ).toBeNull();
  });
});

describe("detectDefaultGrowthAtInflationFor", () => {
  // The banner must quote the rate the ENGINE compounds a category-default
  // account at. `resolveAccountFromRaw` sends those accounts to
  // `resolveCategoryDefault`, NOT to `resolvedInflationRate` — the two differ
  // whenever the plan is on a custom inflation rate.
  const contextWith = (categoryDefaultRate: number, resolvedInflationRate: number) =>
    ({
      resolvedInflationRate,
      resolver: {
        getCategoryGrowthSource: () => "inflation",
        resolveCategoryDefault: () => ({ rate: categoryDefaultRate }),
      },
    }) as unknown as ResolutionContext;

  it("quotes resolveCategoryDefault's rate, not resolvedInflationRate", () => {
    const result = detectDefaultGrowthAtInflationFor(
      contextWith(0.024, 0.03),
      [acct("taxable", 1_000_000, "default")],
    );
    expect(result?.rate).toBe(0.024);
  });

  it("returns null without a resolution context", () => {
    expect(
      detectDefaultGrowthAtInflationFor(undefined, [
        acct("taxable", 1_000_000, "default"),
      ]),
    ).toBeNull();
  });
});
