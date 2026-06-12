import { describe, it, expect } from "vitest";
import { rollupHoldings, firmSlugToAssetClassId, holdingMarketValue, breakdownHoldingsByClass, type HoldingInput } from "../holdings-rollup";

const SLUG_TO_ID = new Map<string, string>([
  ["us_large_cap", "ac-large"],
  ["us_small_cap", "ac-small"],
  ["ten_year_treasury", "ac-10yr"],
  ["emerging_markets", "ac-em"],
]);

function asMap(allocations: { assetClassId: string; weight: number }[]) {
  return Object.fromEntries(
    allocations.map((a) => [a.assetClassId, Number(a.weight.toFixed(4))]),
  );
}

describe("rollupHoldings", () => {
  it("sums value and basis", () => {
    const holdings: HoldingInput[] = [
      { id: "h1", securityId: "s1", shares: 10, price: 100, costBasis: 800, marketValue: null, securityWeights: [], overrides: [] },
      { id: "h2", securityId: "s2", shares: 5, price: 20, costBasis: 90, marketValue: null, securityWeights: [], overrides: [] },
    ];
    const r = rollupHoldings(holdings, SLUG_TO_ID);
    expect(r.value).toBe(1100); // 1000 + 100
    expect(r.basis).toBe(890);  // 800 + 90
  });

  it("value-weights a single classified security's slug blend", () => {
    const holdings: HoldingInput[] = [
      {
        id: "h1", securityId: "s1", shares: 10, price: 100, costBasis: 1000, marketValue: null,
        securityWeights: [
          { slug: "us_large_cap", weight: 0.8 },
          { slug: "us_small_cap", weight: 0.2 },
        ],
        overrides: [],
      },
    ];
    const r = rollupHoldings(holdings, SLUG_TO_ID);
    expect(asMap(r.allocations)).toEqual({ "ac-large": 0.8, "ac-small": 0.2 });
  });

  it("blends two holdings by market value", () => {
    const holdings: HoldingInput[] = [
      // $900 → 100% large
      { id: "h1", securityId: "s1", shares: 9, price: 100, costBasis: 0, marketValue: null,
        securityWeights: [{ slug: "us_large_cap", weight: 1 }], overrides: [] },
      // $100 → 100% 10yr treasury
      { id: "h2", securityId: "s2", shares: 1, price: 100, costBasis: 0, marketValue: null,
        securityWeights: [{ slug: "ten_year_treasury", weight: 1 }], overrides: [] },
    ];
    const r = rollupHoldings(holdings, SLUG_TO_ID);
    expect(asMap(r.allocations)).toEqual({ "ac-large": 0.9, "ac-10yr": 0.1 });
  });

  it("override blend wins over the security blend for that holding", () => {
    const holdings: HoldingInput[] = [
      {
        id: "h1", securityId: "s1", shares: 1, price: 100, costBasis: 0, marketValue: null,
        securityWeights: [{ slug: "us_large_cap", weight: 1 }],
        overrides: [{ assetClassId: "ac-em", weight: 1 }],
      },
    ];
    const r = rollupHoldings(holdings, SLUG_TO_ID);
    expect(asMap(r.allocations)).toEqual({ "ac-em": 1 });
  });

  it("drops slugs with no firm asset class (left as residual)", () => {
    const holdings: HoldingInput[] = [
      {
        id: "h1", securityId: "s1", shares: 1, price: 100, costBasis: 0, marketValue: null,
        securityWeights: [
          { slug: "us_large_cap", weight: 0.5 },
          { slug: "gold", weight: 0.5 }, // not in SLUG_TO_ID → dropped
        ],
        overrides: [],
      },
    ];
    const r = rollupHoldings(holdings, SLUG_TO_ID);
    // Only the matched half survives; the rest is residual (resolver → inflation).
    expect(asMap(r.allocations)).toEqual({ "ac-large": 0.5 });
  });

  it("zero total value yields empty allocations but still sums basis", () => {
    const holdings: HoldingInput[] = [
      { id: "h1", securityId: "s1", shares: 0, price: 0, costBasis: 500, marketValue: null,
        securityWeights: [{ slug: "us_large_cap", weight: 1 }], overrides: [] },
    ];
    const r = rollupHoldings(holdings, SLUG_TO_ID);
    expect(r.value).toBe(0);
    expect(r.basis).toBe(500);
    expect(r.allocations).toEqual([]);
  });

  it("ignores holdings with non-finite market value or weights", () => {
    const holdings: HoldingInput[] = [
      // NaN market value (bad share count) → skipped entirely
      { id: "h1", securityId: "s1", shares: NaN, price: 100, costBasis: 0, marketValue: null,
        securityWeights: [{ slug: "us_large_cap", weight: 1 }], overrides: [] },
      // valid $100 holding with one NaN weight that must be dropped
      { id: "h2", securityId: "s2", shares: 1, price: 100, costBasis: 0, marketValue: null,
        securityWeights: [
          { slug: "us_large_cap", weight: 1 },
          { slug: "us_small_cap", weight: NaN },
        ],
        overrides: [] },
    ];
    const r = rollupHoldings(holdings, SLUG_TO_ID);
    expect(r.allocations).toEqual([{ assetClassId: "ac-large", weight: 1 }]);
  });
});

describe("firmSlugToAssetClassId", () => {
  // Multiple firms seed the same canonical slugs. The map MUST resolve each
  // slug to the *target* firm's asset-class id — picking another firm's id is
  // the cross-firm leak that makes rolled-up allocations read as 0% in the
  // firm-scoped Asset Mix editor (the IDs don't match the firm's classes).
  const rows = [
    { id: "A-large", slug: "us_large_cap", firmId: "firmA" },
    { id: "A-small", slug: "us_small_cap", firmId: "firmA" },
    { id: "B-large", slug: "us_large_cap", firmId: "firmB" },
    { id: "B-small", slug: "us_small_cap", firmId: "firmB" },
  ];

  it("resolves slugs to the target firm's ids only", () => {
    const map = firmSlugToAssetClassId(rows, "firmA");
    expect(Object.fromEntries(map)).toEqual({
      us_large_cap: "A-large",
      us_small_cap: "A-small",
    });
  });

  it("never returns another firm's id even when that firm is listed last", () => {
    // firmB rows come after firmA's — a naive last-write-wins map would pick them.
    const map = firmSlugToAssetClassId(rows, "firmA");
    expect([...map.values()]).not.toContain("B-large");
    expect([...map.values()]).not.toContain("B-small");
  });

  it("skips rows with a null slug", () => {
    const map = firmSlugToAssetClassId(
      [{ id: "A-x", slug: null, firmId: "firmA" }, ...rows],
      "firmA",
    );
    expect([...map.values()]).not.toContain("A-x");
  });
});

const base = { securityWeights: [] as { slug: string; weight: number }[], overrides: [] as { assetClassId: string; weight: number }[] };

describe("holdingMarketValue", () => {
  it("prefers marketValue, falls back to shares×price", () => {
    expect(holdingMarketValue({ marketValue: 27452.5, shares: 25000, price: 109.81 })).toBe(27452.5);
    expect(holdingMarketValue({ marketValue: null, shares: 10, price: 5 })).toBe(50);
  });

  it("treats marketValue: 0 as authoritative (guards against ?? → || regression)", () => {
    // A $0 holding (e.g. fully-amortised bond) must not fall through to shares×price.
    expect(holdingMarketValue({ marketValue: 0, shares: 10, price: 5 })).toBe(0);
  });
});

describe("rollupHoldings", () => {
  it("uses authoritative marketValue for bonds", () => {
    const holdings: HoldingInput[] = [
      { id: "b", securityId: null, shares: 25000, price: 109.81, costBasis: 25912.74, marketValue: 27452.5, ...base },
    ];
    const r = rollupHoldings(holdings, new Map());
    expect(r.value).toBeCloseTo(27452.5, 2); // NOT 2,745,250
  });
});

describe("breakdownHoldingsByClass", () => {
  it("uses authoritative marketValue instead of shares×price for the class contribution", () => {
    // marketValue (500) differs from shares×price (10 × 100 = 1000).
    // The class contribution must reflect marketValue, not shares×price.
    const holdings = [
      {
        id: "h1", ticker: "BOND", name: "Bond Fund",
        securityId: null, shares: 10, price: 100,
        marketValue: 500, // authoritative — differs from 10×100=1000
        securityWeights: [],
        overrides: [{ assetClassId: "ac-fixed", weight: 1 }],
      },
    ];
    const result = breakdownHoldingsByClass(holdings, new Map());
    const contributions = result.get("ac-fixed");
    expect(contributions).toHaveLength(1);
    expect(contributions![0].valueInClass).toBeCloseTo(500, 2); // NOT 1000
  });
});
