// mobile/src/invest/quotes.test.ts
//
// withLiveQuotes: pure holding+quote merge for the investment detail modal.

import { describe, it, expect } from "vitest";
import type { LiveQuote, PortalHolding } from "@contracts";
import { withLiveQuotes } from "./quotes";

function holding(overrides: Partial<PortalHolding> = {}): PortalHolding {
  return {
    ticker: "AAPL",
    name: "Apple Inc.",
    shares: 10,
    price: 150,
    marketValue: 1500,
    costBasis: 1000,
    ...overrides,
  };
}

function quote(overrides: Partial<LiveQuote> = {}): LiveQuote {
  return { price: 155.25, changePct: 0.021, asOf: "2026-07-13T00:00:00Z", ...overrides };
}

describe("withLiveQuotes", () => {
  it("matches a quote by upper-cased ticker", () => {
    const [h] = withLiveQuotes([holding({ ticker: "aapl" })], { AAPL: quote() });
    expect(h.livePrice).toBe(155.25);
    expect(h.changePct).toBe(0.021);
  });

  it("passes through a null-ticker holding with null livePrice/changePct", () => {
    const [h] = withLiveQuotes([holding({ ticker: null })], { AAPL: quote() });
    expect(h.livePrice).toBeNull();
    expect(h.changePct).toBeNull();
  });

  it("returns nulls when no quote exists for the ticker", () => {
    const [h] = withLiveQuotes([holding({ ticker: "MSFT" })], { AAPL: quote() });
    expect(h.livePrice).toBeNull();
    expect(h.changePct).toBeNull();
  });

  it("copies a null changePct straight from the quote", () => {
    const [h] = withLiveQuotes([holding({ ticker: "AAPL" })], { AAPL: quote({ changePct: null }) });
    expect(h.livePrice).toBe(155.25);
    expect(h.changePct).toBeNull();
  });

  it("preserves the original holding fields alongside the quote fields", () => {
    const [h] = withLiveQuotes([holding({ ticker: "AAPL", shares: 4 })], { AAPL: quote() });
    expect(h.shares).toBe(4);
    expect(h.name).toBe("Apple Inc.");
    expect(h.marketValue).toBe(1500);
  });
});
