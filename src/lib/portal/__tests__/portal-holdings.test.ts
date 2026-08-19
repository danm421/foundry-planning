import { describe, it, expect } from "vitest";
import { toPortalHoldings, type HoldingProjectionRow } from "@/lib/portal/portal-holdings";

/** A tickered position with everything reported, as Drizzle hands it over
 *  (decimal columns arrive as strings). */
function row(over: Partial<HoldingProjectionRow> = {}): HoldingProjectionRow {
  return {
    displayTicker: "VTI",
    displayName: "Vanguard Total Stock",
    shares: "500",
    price: "240",
    marketValue: null,
    costBasis: "90000",
    ...over,
  };
}

describe("toPortalHoldings", () => {
  it("carries a reported cost basis through as a number", () => {
    expect(toPortalHoldings([row()])[0].costBasis).toBe(90_000);
  });

  // The whole point of the projection. `account_holdings.cost_basis` is NOT NULL
  // DEFAULT '0' and the Plaid ingest writes `(h.cost_basis ?? 0)`, so a custodian
  // that reports no basis lands here as "0". Printed as $0 in the client portal
  // that reads as "you paid nothing" and makes the position look like 100% gain.
  it("reports an unreported (zero-flattened) cost basis as null, not $0", () => {
    expect(toPortalHoldings([row({ costBasis: "0" })])[0].costBasis).toBeNull();
    expect(toPortalHoldings([row({ costBasis: 0 })])[0].costBasis).toBeNull();
    expect(toPortalHoldings([row({ costBasis: null })])[0].costBasis).toBeNull();
  });

  it("treats a negative or unparseable basis as unreported rather than printing it", () => {
    expect(toPortalHoldings([row({ costBasis: "-1" })])[0].costBasis).toBeNull();
    expect(toPortalHoldings([row({ costBasis: "n/a" })])[0].costBasis).toBeNull();
  });

  it("derives value from shares x price for a tickered row, and honours a stored one", () => {
    // Tickered rows store a null marketValue so the daily price refresh flows
    // through; untickered rows (bonds quote per $100 par) keep a stored value.
    expect(toPortalHoldings([row()])[0].marketValue).toBe(120_000);
    const bond = row({
      displayTicker: null,
      displayName: "Treasury 4.25% 2030",
      shares: "25000",
      price: "99.5",
      marketValue: "24875",
    });
    expect(toPortalHoldings([bond])[0].marketValue).toBe(24_875);
  });

  it("sorts positions largest-first and falls back to the ticker then a dash for a name", () => {
    const out = toPortalHoldings([
      row({ displayTicker: "BND", displayName: null, shares: "10", price: "70" }),
      row(),
      row({ displayTicker: null, displayName: null, shares: "1", price: "5" }),
    ]);
    expect(out.map((h) => h.marketValue)).toEqual([120_000, 700, 5]);
    expect(out[1].name).toBe("BND");
    expect(out[2].name).toBe("—");
  });
});
