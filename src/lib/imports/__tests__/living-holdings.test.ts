// @vitest-environment node
import { describe, it, expect } from "vitest";
import { livingHoldings } from "../living-rows";

describe("livingHoldings", () => {
  it("returns every position that is not tombstoned, in order", () => {
    const row = { holdings: [
      { ticker: "AAPL", marketValue: 100 },
      { ticker: "MSFT", marketValue: 200, __dropped: true },
      { ticker: "VTI", marketValue: 300 },
    ] };
    expect(livingHoldings(row).map((h) => h.ticker)).toEqual(["AAPL", "VTI"]);
  });

  it("treats an absent holdings array as no positions", () => {
    expect(livingHoldings({})).toEqual([]);
  });

  it("treats __dropped: false as living — only true is a tombstone", () => {
    expect(livingHoldings({ holdings: [{ ticker: "AAPL", __dropped: false }] })).toHaveLength(1);
  });
});
