import { describe, it, expect } from "vitest";
import { buildAdHocHoldings } from "./ad-hoc-source";
import type { ResolveTargetDeps, ResolvedSecurity } from "./resolve-target";

/** Resolver stub: everything in `cached` resolves from cache, everything in
 *  `live` resolves on the live path, everything else fails both. */
function deps(
  cached: Record<string, ResolvedSecurity>,
  live: Record<string, ResolvedSecurity> = {},
): ResolveTargetDeps & { liveCalls: string[] } {
  const liveCalls: string[] = [];
  return {
    liveCalls,
    lookupCached: async (t) => cached[t] ?? null,
    classifyLive: async (t) => {
      liveCalls.push(t);
      return live[t] ?? null;
    },
  };
}

const SPY: ResolvedSecurity = {
  securityId: "sec-spy",
  slugWeights: [{ slug: "us-large-cap", weight: 1 }],
};
const AGG: ResolvedSecurity = {
  securityId: "sec-agg",
  slugWeights: [{ slug: "us-bonds", weight: 1 }],
};

describe("buildAdHocHoldings", () => {
  it("derives market value from shares × price and carries the resolved blend", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ ticker: "SPY", shares: 100, price: 50 }] },
      deps({ SPY }),
    );

    expect(currentHoldings).toHaveLength(1);
    expect(currentHoldings[0]).toMatchObject({
      securityId: "sec-spy",
      ticker: "SPY",
      shares: 100,
      price: 50,
      marketValue: 5000,
      isTaxable: true,
      securityWeights: [{ slug: "us-large-cap", weight: 1 }],
      overrides: [],
    });
  });

  it("derives the missing price from market value ÷ shares", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ ticker: "SPY", shares: 200, marketValue: 9000 }] },
      deps({ SPY }),
    );

    expect(currentHoldings[0].price).toBe(45);
    expect(currentHoldings[0].marketValue).toBe(9000);
  });

  it("defaults a missing cost basis to market value so no phantom gain is booked", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ ticker: "SPY", marketValue: 5000 }] },
      deps({ SPY }),
    );

    expect(currentHoldings[0].costBasis).toBe(5000);
  });

  it("keeps an explicit cost basis, including zero", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      {
        taxable: true,
        holdings: [
          { ticker: "SPY", marketValue: 5000, costBasis: 1200 },
          { ticker: "AGG", marketValue: 1000, costBasis: 0 },
        ],
      },
      deps({ SPY, AGG }),
    );

    expect(currentHoldings.map((h) => h.costBasis)).toEqual([1200, 0]);
  });

  it("stamps the account-level taxable flag onto every row", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      {
        taxable: false,
        holdings: [
          { ticker: "SPY", marketValue: 1 },
          { ticker: "AGG", marketValue: 1 },
        ],
      },
      deps({ SPY, AGG }),
    );

    expect(currentHoldings.every((h) => h.isTaxable === false)).toBe(true);
  });

  it("falls back to the live classifier when the ticker is not cached", async () => {
    const d = deps({}, { AGG });
    const { currentHoldings, unresolved } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ ticker: "agg", marketValue: 1000 }] },
      d,
    );

    expect(d.liveCalls).toEqual(["AGG"]);
    expect(unresolved).toEqual([]);
    expect(currentHoldings[0].securityId).toBe("sec-agg");
  });

  it("normalizes tickers to trimmed upper case", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ ticker: "  spy  ", marketValue: 100 }] },
      deps({ SPY }),
    );

    expect(currentHoldings[0].ticker).toBe("SPY");
  });

  it("keeps an unclassifiable ticker's value but contributes no blend, and reports it", async () => {
    const { currentHoldings, unresolved } = await buildAdHocHoldings(
      {
        taxable: true,
        holdings: [
          { ticker: "SPY", marketValue: 7000 },
          { ticker: "ZZZZ", marketValue: 3000, costBasis: 2000 },
        ],
      },
      deps({ SPY }),
    );

    expect(unresolved).toEqual(["ZZZZ"]);
    const zzzz = currentHoldings[1];
    expect(zzzz.marketValue).toBe(3000);
    expect(zzzz.costBasis).toBe(2000);
    expect(zzzz.securityId).toBeNull();
    expect(zzzz.securityWeights).toEqual([]);
  });

  it("keeps an untickered row (bond / cash) without ever calling the classifier", async () => {
    const d = deps({});
    const { currentHoldings, unresolved } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ name: "Cash", marketValue: 25_000 }] },
      d,
    );

    expect(d.liveCalls).toEqual([]);
    expect(unresolved).toEqual([]);
    expect(currentHoldings[0]).toMatchObject({
      securityId: null,
      ticker: "Cash",
      marketValue: 25_000,
      securityWeights: [],
    });
  });

  it("prices cash at $1 so a share-quantity cash row still carries value", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ name: "Cash", shares: 25_000 }] },
      deps({}),
    );

    expect(currentHoldings[0].marketValue).toBe(25_000);
  });

  it("drops rows that name neither a ticker nor a description", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      {
        taxable: true,
        holdings: [{ ticker: "  ", name: "  ", marketValue: 100 }, { ticker: "SPY", marketValue: 1 }],
      },
      deps({ SPY }),
    );

    expect(currentHoldings.map((h) => h.ticker)).toEqual(["SPY"]);
  });

  it("gives every row a distinct id so the rollup does not collapse duplicates", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      {
        taxable: true,
        holdings: [
          { ticker: "SPY", marketValue: 100 },
          { ticker: "SPY", marketValue: 200 },
        ],
      },
      deps({ SPY }),
    );

    expect(new Set(currentHoldings.map((h) => h.id)).size).toBe(2);
  });

  it("resolves each distinct ticker once even when it appears on several rows", async () => {
    const d = deps({}, { SPY });
    await buildAdHocHoldings(
      {
        taxable: true,
        holdings: [
          { ticker: "SPY", marketValue: 100 },
          { ticker: "SPY", marketValue: 200 },
        ],
      },
      d,
    );

    expect(d.liveCalls).toEqual(["SPY"]);
  });

  it("reports an unresolvable ticker once, not once per row", async () => {
    const { unresolved } = await buildAdHocHoldings(
      {
        taxable: true,
        holdings: [
          { ticker: "ZZZZ", marketValue: 100 },
          { ticker: "ZZZZ", marketValue: 200 },
        ],
      },
      deps({}),
    );

    expect(unresolved).toEqual(["ZZZZ"]);
  });

  it("treats a zero-share row as zero value rather than dividing by zero", async () => {
    const { currentHoldings } = await buildAdHocHoldings(
      { taxable: true, holdings: [{ ticker: "SPY", shares: 0, price: 10 }] },
      deps({ SPY }),
    );

    expect(currentHoldings[0].marketValue).toBe(0);
    expect(Number.isFinite(currentHoldings[0].price)).toBe(true);
  });
});
