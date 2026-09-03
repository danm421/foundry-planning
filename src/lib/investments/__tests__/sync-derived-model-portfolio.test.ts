import { describe, it, expect, vi } from "vitest";
import {
  syncDerivedAllocations,
  type SyncDeps,
} from "@/lib/investments/sync-derived-model-portfolio";

const args = { tickerPortfolioId: "tp1", modelPortfolioId: "mp1", firmId: "firm1" };

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps & {
  writeAllocations: ReturnType<typeof vi.fn>;
} {
  return {
    loadHoldings: async () => [
      { ticker: "VT", weight: 0.4, slugWeights: [{ slug: "us_large_cap", weight: 1 }] },
      { ticker: "BND", weight: 0.6, slugWeights: [{ slug: "ten_year_treasury", weight: 1 }] },
    ],
    loadSlugMap: async () => ({ us_large_cap: "ac-stock", ten_year_treasury: "ac-bond" }),
    writeAllocations: vi.fn(async () => {}),
    ...overrides,
  } as SyncDeps & { writeAllocations: ReturnType<typeof vi.fn> };
}

describe("syncDerivedAllocations", () => {
  it("writes normalized allocations for a fully classified fund", async () => {
    const d = deps();
    const out = await syncDerivedAllocations(args, d);
    expect(out.ok).toBe(true);
    expect(out.written).toBe(2);
    expect(d.writeAllocations).toHaveBeenCalledWith(
      "mp1",
      expect.arrayContaining([
        { assetClassId: "ac-stock", weight: 0.4 },
        { assetClassId: "ac-bond", weight: 0.6 },
      ]),
    );
  });

  it("blends a multi-asset-class holding through its slug weights", async () => {
    const d = deps({
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
    });
    const out = await syncDerivedAllocations(args, d);
    expect(out.ok).toBe(true);
    expect(d.writeAllocations).toHaveBeenCalledWith(
      "mp1",
      expect.arrayContaining([
        { assetClassId: "ac-stock", weight: 0.6 },
        { assetClassId: "ac-bond", weight: 0.4 },
      ]),
    );
  });

  it("does NOT write when the gate fails — prior allocations survive", async () => {
    const d = deps({
      loadHoldings: async () => [
        { ticker: "VT", weight: 0.8, slugWeights: [{ slug: "us_large_cap", weight: 1 }] },
        { ticker: "PRIV", weight: 0.2, slugWeights: [] },
      ],
    });
    const out = await syncDerivedAllocations(args, d);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("unclassified");
    expect(out.unclassifiedWeight).toBeCloseTo(0.2, 10);
    expect(out.written).toBe(0);
    expect(d.writeAllocations).not.toHaveBeenCalled();
  });

  it("does NOT write when the fund has no holdings", async () => {
    const d = deps({ loadHoldings: async () => [] });
    const out = await syncDerivedAllocations(args, d);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("empty");
    expect(d.writeAllocations).not.toHaveBeenCalled();
  });

  it("reports a slug the firm has no asset class for", async () => {
    const d = deps({ loadSlugMap: async () => ({ us_large_cap: "ac-stock" }) });
    const out = await syncDerivedAllocations(args, d);
    expect(out.ok).toBe(false);
    expect(out.droppedSlugs).toContain("ten_year_treasury");
    expect(d.writeAllocations).not.toHaveBeenCalled();
  });

  it("passes the model portfolio id through, not the fund's", async () => {
    const d = deps();
    await syncDerivedAllocations(
      { tickerPortfolioId: "tp-source", modelPortfolioId: "mp-target", firmId: "firm1" },
      d,
    );
    expect(d.writeAllocations).toHaveBeenCalledWith("mp-target", expect.anything());
  });
});
