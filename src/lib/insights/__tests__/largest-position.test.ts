import { describe, it, expect } from "vitest";
import { pickLargestPosition } from "../largest-position";

describe("pickLargestPosition", () => {
  it("returns null for no holdings", () => {
    expect(pickLargestPosition([])).toBeNull();
  });

  it("aggregates the same ticker across accounts", () => {
    const out = pickLargestPosition([
      { ticker: "AAPL", name: "Apple", marketValue: null, shares: 100, price: 200 },
      { ticker: "AAPL", name: "Apple", marketValue: null, shares: 50, price: 200 },
      { ticker: "VTI", name: "Vanguard", marketValue: null, shares: 100, price: 250 },
    ]);
    expect(out).toEqual({ label: "AAPL", value: 30_000 });
  });

  it("prefers the stored marketValue over shares x price", () => {
    // A bond quoting per $100 par: shares x price would read 100 x 98 = 9,800.
    const out = pickLargestPosition([
      { ticker: null, name: "US Treasury 2031", marketValue: 98_000, shares: 100, price: 98 },
    ]);
    expect(out).toEqual({ label: "US Treasury 2031", value: 98_000 });
  });

  it("falls back to the display name when there is no ticker", () => {
    const out = pickLargestPosition([
      { ticker: null, name: "Private REIT", marketValue: 500_000, shares: 0, price: 0 },
    ]);
    expect(out!.label).toBe("Private REIT");
  });

  it("ignores holdings that classify to nothing at all", () => {
    const out = pickLargestPosition([
      { ticker: null, name: null, marketValue: 900_000, shares: 0, price: 0 },
      { ticker: "VTI", name: "Vanguard", marketValue: 10_000, shares: 0, price: 0 },
    ]);
    expect(out).toEqual({ label: "VTI", value: 10_000 });
  });
});
