import { describe, it, expect } from "vitest";
import {
  tickerPortfolioAllocationRows,
  tickerPortfolioBlendedReturnPct,
} from "@/lib/investments/ticker-portfolio-allocation";

const holdings = [
  { weight: 0.6, slugWeights: [{ slug: "us_large", weight: 1 }] },
  { weight: 0.4, slugWeights: [{ slug: "agg_bond", weight: 1 }] },
];
const slugToAssetClassId = { us_large: "ac-stock", agg_bond: "ac-bond" };

describe("tickerPortfolioAllocationRows", () => {
  it("blends holdings to firm asset-class weights", () => {
    const rows = tickerPortfolioAllocationRows(holdings, slugToAssetClassId);
    expect(rows).toEqual(
      expect.arrayContaining([
        { assetClassId: "ac-stock", weight: 0.6 },
        { assetClassId: "ac-bond", weight: 0.4 },
      ]),
    );
  });

  it("drops slugs with no firm asset class (left as unclassified remainder)", () => {
    const rows = tickerPortfolioAllocationRows(
      [{ weight: 1, slugWeights: [{ slug: "gold", weight: 0.5 }, { slug: "us_large", weight: 0.5 }] }],
      slugToAssetClassId, // no "gold"
    );
    expect(rows).toEqual([{ assetClassId: "ac-stock", weight: 0.5 }]);
  });
});

describe("tickerPortfolioBlendedReturnPct", () => {
  it("sums weight × geometric return, in percent", () => {
    const acReturns = { "ac-stock": 0.08, "ac-bond": 0.03 };
    // 0.6*0.08 + 0.4*0.03 = 0.06 -> 6.00
    expect(
      tickerPortfolioBlendedReturnPct(
        tickerPortfolioAllocationRows(holdings, slugToAssetClassId),
        acReturns,
      ),
    ).toBeCloseTo(6.0, 6);
  });

  it("returns null when no rows classify", () => {
    expect(tickerPortfolioBlendedReturnPct([], { "ac-stock": 0.08 })).toBeNull();
  });
});
