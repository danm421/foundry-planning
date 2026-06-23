import { describe, it, expect } from "vitest";
import { enrichHoldingRows, type RawHoldingRow } from "../route";

const baseRow: RawHoldingRow = {
  id: "h1", accountId: "a1", securityId: "s1",
  displayTicker: "VTI", displayName: "Vanguard Total",
  shares: "10", price: "100", priceAsOf: "2026-05-28", costBasis: "800",
  marketValue: null,
  sortOrder: 0, notes: null,
  source: "manual", plaidSecurityId: null,
  createdAt: new Date("2026-05-28T00:00:00Z"), updatedAt: new Date("2026-05-28T00:00:00Z"),
};

describe("enrichHoldingRows", () => {
  it("attaches security weights + overrides and flags needsReview=false when classified", () => {
    const out = enrichHoldingRows(
      [baseRow],
      new Map([["s1", [{ slug: "us_large_cap", weight: 1 }]]]),
      new Map(),
    );
    expect(out[0].securityWeights).toEqual([{ slug: "us_large_cap", weight: 1 }]);
    expect(out[0].overrides).toEqual([]);
    expect(out[0].needsReview).toBe(false);
  });

  it("override presence wins and clears needsReview even with no security weights", () => {
    const manual: RawHoldingRow = { ...baseRow, id: "h2", securityId: null, displayTicker: "PRIVATEBOND" };
    const out = enrichHoldingRows(
      [manual],
      new Map(),
      new Map([["h2", [{ assetClassId: "ac-em", weight: 1 }]]]),
    );
    expect(out[0].securityWeights).toEqual([]);
    expect(out[0].overrides).toEqual([{ assetClassId: "ac-em", weight: 1 }]);
    expect(out[0].needsReview).toBe(false);
  });

  it("needsReview=true when nothing classifies the holding", () => {
    const manual: RawHoldingRow = { ...baseRow, id: "h3", securityId: null };
    const out = enrichHoldingRows([manual], new Map(), new Map());
    expect(out[0].needsReview).toBe(true);
  });
});
