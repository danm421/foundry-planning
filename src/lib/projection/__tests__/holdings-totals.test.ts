import { describe, it, expect } from "vitest";
import { computeHoldingsTotals } from "../holdings-totals";

const SLUGS = new Map([["us_large", "ac-large"], ["us_bond", "ac-bond"]]);

const holding = (over = {}) => ({
  id: "h1", securityId: "s1", shares: 10, price: 100, costBasis: 500,
  marketValue: null,
  securityWeights: [{ slug: "us_large", weight: 1 }], overrides: [],
  ...over,
});

describe("computeHoldingsTotals", () => {
  it("includes an account only when deriveFromHoldings is true AND it has holdings", () => {
    const map = computeHoldingsTotals({
      accounts: [
        { id: "a1", deriveFromHoldings: true },
        { id: "a2", deriveFromHoldings: false },
        { id: "a3", deriveFromHoldings: true },
      ],
      holdingsByAccountId: new Map([
        ["a1", [holding()]],
        ["a2", [holding()]],
      ]),
      slugToAssetClassId: SLUGS,
    });
    expect(map.get("a1")).toEqual({ value: 1000, basis: 500 });
    expect(map.has("a2")).toBe(false); // deriveFromHoldings false → excluded
    expect(map.has("a3")).toBe(false); // no holdings → excluded
  });

  it("treats null/undefined deriveFromHoldings as true (column default)", () => {
    const map = computeHoldingsTotals({
      accounts: [{ id: "a1", deriveFromHoldings: null }],
      holdingsByAccountId: new Map([["a1", [holding()]]]),
      slugToAssetClassId: SLUGS,
    });
    expect(map.get("a1")).toEqual({ value: 1000, basis: 500 });
  });
});
