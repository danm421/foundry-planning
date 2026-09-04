import { describe, it, expect } from "vitest";
import {
  deriveAllocationsForFund,
  type SyncDeps,
} from "@/lib/investments/sync-derived-model-portfolio";

const args = { tickerPortfolioId: "tp1", firmId: "firm1" };

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    loadHoldings: async () => [
      { ticker: "VT", weight: 0.4, slugWeights: [{ slug: "us_large_cap", weight: 1 }] },
      { ticker: "BND", weight: 0.6, slugWeights: [{ slug: "ten_year_treasury", weight: 1 }] },
    ],
    loadSlugMap: async () => ({ us_large_cap: "ac-stock", ten_year_treasury: "ac-bond" }),
    ...overrides,
  };
}

describe("deriveAllocationsForFund", () => {
  it("returns normalized allocations for a fully classified fund", async () => {
    const out = await deriveAllocationsForFund(args, deps());
    expect(out.ok).toBe(true);
    expect(out.allocations).toEqual(
      expect.arrayContaining([
        { assetClassId: "ac-stock", weight: 0.4 },
        { assetClassId: "ac-bond", weight: 0.6 },
      ]),
    );
  });

  it("blends a multi-asset-class holding through its slug weights", async () => {
    const out = await deriveAllocationsForFund(
      args,
      deps({
        loadHoldings: async () => [
          {
            ticker: "VT",
            weight: 1,
            slugWeights: [
              { slug: "us_large_cap", weight: 0.6 },
              { slug: "ten_year_treasury", weight: 0.4 },
            ],
          },
        ],
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.allocations).toEqual(
      expect.arrayContaining([
        { assetClassId: "ac-stock", weight: 0.6 },
        { assetClassId: "ac-bond", weight: 0.4 },
      ]),
    );
  });

  it("returns NO allocations when the gate fails, so the caller writes nothing", async () => {
    const out = await deriveAllocationsForFund(
      args,
      deps({
        loadHoldings: async () => [
          { ticker: "VT", weight: 0.8, slugWeights: [{ slug: "us_large_cap", weight: 1 }] },
          { ticker: "PRIV", weight: 0.2, slugWeights: [] },
        ],
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("unclassified");
    expect(out.unclassifiedWeight).toBeCloseTo(0.2, 10);
    expect(out.allocations).toEqual([]);
  });

  it("reports an empty fund distinctly from an unclassifiable one", async () => {
    const out = await deriveAllocationsForFund(args, deps({ loadHoldings: async () => [] }));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("empty");
    expect(out.allocations).toEqual([]);
  });

  it("names a slug the firm has no asset class for", async () => {
    const out = await deriveAllocationsForFund(
      args,
      deps({ loadSlugMap: async () => ({ us_large_cap: "ac-stock" }) }),
    );
    expect(out.ok).toBe(false);
    expect(out.droppedSlugs).toContain("ten_year_treasury");
    expect(out.allocations).toEqual([]);
  });

  it("does not read the slug map before it knows there are holdings", async () => {
    // An empty fund must short-circuit: the slug-map query is pure waste there,
    // and in the cron that is one wasted query per unpromoted portfolio.
    let slugMapReads = 0;
    await deriveAllocationsForFund(
      args,
      deps({
        loadHoldings: async () => [],
        loadSlugMap: async () => {
          slugMapReads++;
          return {};
        },
      }),
    );
    expect(slugMapReads).toBe(0);
  });
});
