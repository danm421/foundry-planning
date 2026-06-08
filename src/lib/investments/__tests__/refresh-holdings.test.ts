import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("@/db", () => ({ db: { execute: (q: unknown) => mockExecute(q) } }));

const mockFetchEodCloses = vi.fn();
// Preserve the real module (eodhdSymbol etc.); override only the batch fetcher.
vi.mock("@/lib/investments/quote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investments/quote")>()),
  fetchEodCloses: (...a: unknown[]) => mockFetchEodCloses(...a),
}));

const mockSync = vi.fn();
vi.mock("@/lib/investments/sync-account-from-holdings", () => ({
  syncAccountFromHoldings: (...a: unknown[]) => mockSync(...a),
}));

import { refreshHoldings } from "../refresh-holdings";

beforeEach(() => {
  mockExecute.mockReset().mockResolvedValue(undefined);
  mockFetchEodCloses.mockReset();
  mockSync.mockReset().mockResolvedValue(undefined);
});

describe("refreshHoldings", () => {
  it("updates changed holdings, lists missing tickers, resyncs affected accounts", async () => {
    mockFetchEodCloses.mockResolvedValue(
      new Map([["VTI.US", { price: 372.54, asOf: "2026-05-29" }]]),
    );
    const summary = await refreshHoldings([
      { id: "h1", accountId: "a1", displayTicker: "VTI", priceAsOf: "2026-05-28", deriveFromHoldings: true },
      { id: "h2", accountId: "a2", displayTicker: "VTI", priceAsOf: "2026-05-29", deriveFromHoldings: true }, // unchanged date
      { id: "h3", accountId: "a3", displayTicker: "FOOBAR", priceAsOf: null, deriveFromHoldings: true },        // no quote
    ]);
    expect(summary.holdingsUpdated).toBe(1);            // only h1
    expect(summary.tickersMissing).toEqual(["FOOBAR"]);
    expect(summary.accountsResynced).toBe(1);
    expect(summary.resyncFailures).toEqual([]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith("a1");
  });

  it("skips the bulk update and resync when nothing changed", async () => {
    mockFetchEodCloses.mockResolvedValue(
      new Map([["VTI.US", { price: 372.54, asOf: "2026-05-29" }]]),
    );
    const summary = await refreshHoldings([
      { id: "h2", accountId: "a2", displayTicker: "VTI", priceAsOf: "2026-05-29", deriveFromHoldings: true },
    ]);
    expect(summary.holdingsUpdated).toBe(0);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("captures a resync failure without throwing", async () => {
    mockFetchEodCloses.mockResolvedValue(
      new Map([["VTI.US", { price: 372.54, asOf: "2026-05-29" }]]),
    );
    mockSync.mockRejectedValueOnce(new Error("boom"));
    const summary = await refreshHoldings([
      { id: "h1", accountId: "a1", displayTicker: "VTI", priceAsOf: "2026-05-28", deriveFromHoldings: true },
    ]);
    expect(summary.accountsResynced).toBe(0);
    expect(summary.resyncFailures).toEqual([{ accountId: "a1", message: "boom" }]);
  });
});
