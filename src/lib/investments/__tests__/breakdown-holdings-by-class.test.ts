import { describe, it, expect } from "vitest";
import { breakdownHoldingsByClass, type HoldingForBreakdown } from "../holdings-rollup";

const SLUG_TO_ID = new Map<string, string>([
  ["us_large_cap", "ac-large"],
  ["us_small_cap", "ac-small"],
  ["ten_year_treasury", "ac-10yr"],
]);

function pos(
  p: Partial<HoldingForBreakdown> & Pick<HoldingForBreakdown, "id">,
): HoldingForBreakdown {
  return {
    ticker: "TICK",
    name: "Name",
    securityId: "s1",
    shares: 1,
    price: 100,
    marketValue: null,
    securityWeights: [],
    overrides: [],
    ...p,
  };
}

describe("breakdownHoldingsByClass", () => {
  it("places a single-class holding fully in its class", () => {
    const out = breakdownHoldingsByClass(
      [pos({ id: "h1", ticker: "VOO", name: "Vanguard S&P 500", shares: 10, price: 100, securityWeights: [{ slug: "us_large_cap", weight: 1 }] })],
      SLUG_TO_ID,
    );
    expect(out.get("ac-large")).toEqual([
      { holdingId: "h1", ticker: "VOO", name: "Vanguard S&P 500", valueInClass: 1000, blendWeight: 1 },
    ]);
  });

  it("splits a blended fund across the classes it touches, carrying only each slice", () => {
    const out = breakdownHoldingsByClass(
      [pos({ id: "h1", ticker: "VBIAX", name: "Balanced", shares: 1, price: 1000, securityWeights: [
        { slug: "us_large_cap", weight: 0.6 },
        { slug: "ten_year_treasury", weight: 0.4 },
      ] })],
      SLUG_TO_ID,
    );
    expect(out.get("ac-large")?.[0].valueInClass).toBe(600);
    expect(out.get("ac-large")?.[0].blendWeight).toBe(0.6);
    expect(out.get("ac-10yr")?.[0].valueInClass).toBe(400);
  });

  it("lets an override blend win over the security blend", () => {
    const out = breakdownHoldingsByClass(
      [pos({ id: "h1", ticker: "X", name: "X", shares: 1, price: 500,
        securityWeights: [{ slug: "us_large_cap", weight: 1 }],
        overrides: [{ assetClassId: "ac-small", weight: 1 }] })],
      SLUG_TO_ID,
    );
    expect(out.has("ac-large")).toBe(false);
    expect(out.get("ac-small")?.[0].valueInClass).toBe(500);
  });

  it("skips holdings with zero or negative market value", () => {
    const out = breakdownHoldingsByClass(
      [pos({ id: "h1", shares: 0, price: 100, securityWeights: [{ slug: "us_large_cap", weight: 1 }] })],
      SLUG_TO_ID,
    );
    expect(out.size).toBe(0);
  });

  it("a holding's slices sum to its classified market value", () => {
    const out = breakdownHoldingsByClass(
      [pos({ id: "h1", shares: 1, price: 1000, securityWeights: [
        { slug: "us_large_cap", weight: 0.7 },
        { slug: "us_small_cap", weight: 0.3 },
      ] })],
      SLUG_TO_ID,
    );
    const total = (out.get("ac-large")?.[0].valueInClass ?? 0) + (out.get("ac-small")?.[0].valueInClass ?? 0);
    expect(total).toBe(1000);
  });

  it("sorts holdings within a class by value descending", () => {
    const out = breakdownHoldingsByClass(
      [
        pos({ id: "h1", ticker: "SMALL", shares: 1, price: 100, securityWeights: [{ slug: "us_large_cap", weight: 1 }] }),
        pos({ id: "h2", ticker: "BIG", shares: 1, price: 900, securityWeights: [{ slug: "us_large_cap", weight: 1 }] }),
      ],
      SLUG_TO_ID,
    );
    expect(out.get("ac-large")?.map((h) => h.ticker)).toEqual(["BIG", "SMALL"]);
  });

  it("drops a security-weight slug that has no firm asset-class id", () => {
    const out = breakdownHoldingsByClass(
      [pos({ id: "h1", shares: 1, price: 100, securityWeights: [{ slug: "unknown_slug", weight: 1 }] })],
      SLUG_TO_ID,
    );
    expect(out.size).toBe(0);
  });
});
