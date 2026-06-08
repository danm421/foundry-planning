import { describe, it, expect } from "vitest";
import { planPriceUpdates, type RefreshHoldingInput } from "../price-refresh";

const h = (over: Partial<RefreshHoldingInput>): RefreshHoldingInput => ({
  id: "h1",
  accountId: "a1",
  displayTicker: "VTI",
  priceAsOf: "2026-05-28",
  deriveFromHoldings: true,
  ...over,
});

const quotes = (entries: Record<string, { price: number; asOf: string }>) =>
  new Map(Object.entries(entries));

describe("planPriceUpdates", () => {
  it("updates a holding when the quote date is newer", () => {
    const plan = planPriceUpdates({
      holdings: [h({})],
      quotes: quotes({ "VTI.US": { price: 372.54, asOf: "2026-05-29" } }),
    });
    expect(plan.holdingUpdates).toEqual([{ id: "h1", price: 372.54, asOf: "2026-05-29" }]);
    expect(plan.accountsToResync).toEqual(["a1"]);
  });

  it("skips a holding whose priceAsOf already equals the quote date", () => {
    const plan = planPriceUpdates({
      holdings: [h({ priceAsOf: "2026-05-29" })],
      quotes: quotes({ "VTI.US": { price: 372.54, asOf: "2026-05-29" } }),
    });
    expect(plan.holdingUpdates).toEqual([]);
    expect(plan.accountsToResync).toEqual([]);
  });

  it("skips a holding with no matching quote (missing/N-D)", () => {
    const plan = planPriceUpdates({
      holdings: [h({ displayTicker: "ZZZZ" })],
      quotes: quotes({ "VTI.US": { price: 372.54, asOf: "2026-05-29" } }),
    });
    expect(plan.holdingUpdates).toEqual([]);
  });

  it("ignores holdings with an empty ticker", () => {
    const plan = planPriceUpdates({
      holdings: [h({ displayTicker: "" })],
      quotes: quotes({ "VTI.US": { price: 1, asOf: "2026-05-29" } }),
    });
    expect(plan.holdingUpdates).toEqual([]);
  });

  it("does not re-sync accounts that are not holdings-driven, but still updates the price", () => {
    const plan = planPriceUpdates({
      holdings: [h({ deriveFromHoldings: false })],
      quotes: quotes({ "VTI.US": { price: 372.54, asOf: "2026-05-29" } }),
    });
    expect(plan.holdingUpdates).toHaveLength(1);
    expect(plan.accountsToResync).toEqual([]);
  });

  it("maps a class-share ticker through eodhdSymbol and dedups accounts", () => {
    const plan = planPriceUpdates({
      holdings: [
        h({ id: "h1", accountId: "a1", displayTicker: "BRK.B", priceAsOf: "2026-05-28" }),
        h({ id: "h2", accountId: "a1", displayTicker: "VTI", priceAsOf: "2026-05-28" }),
      ],
      quotes: quotes({
        "BRK-B.US": { price: 640.1, asOf: "2026-05-29" },
        "VTI.US": { price: 372.54, asOf: "2026-05-29" },
      }),
    });
    expect(plan.holdingUpdates.map((u) => u.id).sort()).toEqual(["h1", "h2"]);
    expect(plan.accountsToResync).toEqual(["a1"]);
  });
});
