import { describe, it, expect } from "vitest";
import { resolveTargetAllocations, type ResolveTargetDeps } from "./resolve-target";

const cached =
  (table: Record<string, { securityId: string; slugWeights: { slug: string; weight: number }[] }>) =>
  async (ticker: string) => table[ticker] ?? null;

const noLive: ResolveTargetDeps["classifyLive"] = async () => null;

describe("resolveTargetAllocations", () => {
  it("yields a non-empty allocation for a classifiable ticker (and normalizes case + weight)", async () => {
    const slugToId = new Map([["us_equity", "ac-us"]]);
    const deps: ResolveTargetDeps = {
      lookupCached: cached({ SPY: { securityId: "sec-spy", slugWeights: [{ slug: "us_equity", weight: 1 }] } }),
      classifyLive: noLive,
    };
    const res = await resolveTargetAllocations([{ ticker: "spy", weight: 0.3 }], slugToId, deps);
    expect(res.unresolved).toEqual([]);
    expect(res.targetHoldings).toEqual([{ securityId: "sec-spy", ticker: "SPY", weight: 1 }]);
    expect(res.targetAllocations).toEqual([{ assetClassId: "ac-us", weight: 1 }]);
  });

  it("reports an unclassifiable ticker instead of emitting a silent empty target", async () => {
    const deps: ResolveTargetDeps = { lookupCached: cached({}), classifyLive: noLive };
    const res = await resolveTargetAllocations([{ ticker: "ZZZZ", weight: 1 }], new Map(), deps);
    expect(res.unresolved).toEqual(["ZZZZ"]);
    expect(res.targetHoldings).toEqual([]);
    expect(res.targetAllocations).toEqual([]);
  });

  it("is cache-first: does not call classifyLive when the cache resolves", async () => {
    let liveCalls = 0;
    const deps: ResolveTargetDeps = {
      lookupCached: cached({ SPY: { securityId: "s", slugWeights: [{ slug: "us_equity", weight: 1 }] } }),
      classifyLive: async () => { liveCalls++; return null; },
    };
    await resolveTargetAllocations([{ ticker: "SPY", weight: 1 }], new Map([["us_equity", "ac"]]), deps);
    expect(liveCalls).toBe(0);
  });

  it("normalizes relative weights so allocations sum to 1.0", async () => {
    const slugToId = new Map([["us_equity", "ac-us"], ["bond", "ac-bd"]]);
    const deps: ResolveTargetDeps = {
      lookupCached: cached({
        SPY: { securityId: "s1", slugWeights: [{ slug: "us_equity", weight: 1 }] },
        BND: { securityId: "s2", slugWeights: [{ slug: "bond", weight: 1 }] },
      }),
      classifyLive: noLive,
    };
    const res = await resolveTargetAllocations(
      [{ ticker: "SPY", weight: 0.2 }, { ticker: "BND", weight: 0.1 }],
      slugToId,
      deps,
    );
    const sum = res.targetAllocations.reduce((s, a) => s + a.weight, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(res.targetAllocations).toHaveLength(2);
    const byId = Object.fromEntries(res.targetAllocations.map((a) => [a.assetClassId, a.weight]));
    expect(byId["ac-us"]).toBeCloseTo(2 / 3, 6);
    expect(byId["ac-bd"]).toBeCloseTo(1 / 3, 6);
  });
});
