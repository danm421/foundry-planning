import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectHoldings = vi.fn();
const mockRunInsert = vi.fn();
const mockRunUpdate = vi.fn();
const mockExecute = vi.fn();

vi.mock("@/db", async () => {
  const schema = (await import("@/db/schema")) as Record<string, unknown>;
  return {
    db: {
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: () => mockSelectHoldings() }) }),
      }),
      insert: () => ({
        values: (v: unknown) => ({ returning: () => mockRunInsert(v) }),
      }),
      update: (tbl: unknown) => {
        void tbl;
        return { set: (v: unknown) => ({ where: () => mockRunUpdate(v) }) };
      },
      execute: (q: unknown) => mockExecute(q),
    },
  };
});

const mockFetchEodCloses = vi.fn();
// Preserve the real module (eodhdSymbol etc.) and override only the batch
// fetcher — planPriceUpdates (not mocked) calls the real eodhdSymbol.
vi.mock("@/lib/investments/quote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investments/quote")>()),
  fetchEodCloses: (...a: unknown[]) => mockFetchEodCloses(...a),
}));

const mockSync = vi.fn();
vi.mock("@/lib/investments/sync-account-from-holdings", () => ({
  syncAccountFromHoldings: (...a: unknown[]) => mockSync(...a),
}));

const mockSentry = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => mockSentry(...a) }));

import { GET } from "../route";

beforeEach(() => {
  mockSelectHoldings.mockReset();
  mockRunInsert.mockReset();
  mockRunUpdate.mockReset();
  mockExecute.mockReset();
  mockFetchEodCloses.mockReset();
  mockSync.mockReset();
  mockSentry.mockReset();
  process.env.CRON_SECRET = "secret_t";
  mockRunInsert.mockResolvedValue([{ id: "run_1" }]);
  mockExecute.mockResolvedValue(undefined);
  mockSync.mockResolvedValue(undefined);
});

const authed = () =>
  new Request("http://localhost/api/cron/refresh-holding-prices", {
    headers: { authorization: "Bearer secret_t" },
  }) as never;

describe("GET /api/cron/refresh-holding-prices", () => {
  it("401 without auth", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/refresh-holding-prices") as never,
    );
    expect(res.status).toBe(401);
  });

  it("401 with wrong token", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/refresh-holding-prices", {
        headers: { authorization: "Bearer nope" },
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("updates changed holdings and re-syncs holdings-driven accounts", async () => {
    mockSelectHoldings.mockResolvedValue([
      { id: "h1", accountId: "a1", displayTicker: "VTI", priceAsOf: "2026-05-28", deriveFromHoldings: true },
      { id: "h2", accountId: "a2", displayTicker: "VTI", priceAsOf: "2026-05-29", deriveFromHoldings: true }, // unchanged
      { id: "h3", accountId: "a3", displayTicker: "AAPL", priceAsOf: null, deriveFromHoldings: false },       // priced, no resync
    ]);
    mockFetchEodCloses.mockResolvedValue(
      new Map([
        ["VTI.US", { price: 372.54, asOf: "2026-05-29" }],
        ["AAPL.US", { price: 312.06, asOf: "2026-05-29" }],
      ]),
    );

    const res = await GET(authed());
    expect(res.status).toBe(200);

    // h1 and h3 change; h2 is unchanged-date.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    // Only a1 is holdings-driven among the changed holdings.
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith("a1");
    expect(mockRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok", holdingsUpdated: 2, accountsResynced: 1 }),
    );
    expect(mockSentry).not.toHaveBeenCalled();
  });

  it("records a re-sync failure as status='partial' and fires Sentry", async () => {
    mockSelectHoldings.mockResolvedValue([
      { id: "h1", accountId: "a1", displayTicker: "VTI", priceAsOf: "2026-05-28", deriveFromHoldings: true },
    ]);
    mockFetchEodCloses.mockResolvedValue(
      new Map([["VTI.US", { price: 372.54, asOf: "2026-05-29" }]]),
    );
    mockSync.mockRejectedValueOnce(new Error("boom"));

    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(mockRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "partial" }),
    );
    expect(mockSentry).toHaveBeenCalledWith(
      "Holding price refresh failures",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("no changed holdings ⇒ no bulk update, status='ok'", async () => {
    mockSelectHoldings.mockResolvedValue([
      { id: "h2", accountId: "a2", displayTicker: "VTI", priceAsOf: "2026-05-29", deriveFromHoldings: true },
    ]);
    mockFetchEodCloses.mockResolvedValue(
      new Map([["VTI.US", { price: 372.54, asOf: "2026-05-29" }]]),
    );
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok", holdingsUpdated: 0 }),
    );
  });

  it("status='error' + 500 when the holdings load throws", async () => {
    mockSelectHoldings.mockRejectedValue(new Error("db down"));
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect(mockRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(mockSentry).toHaveBeenCalledWith(
      "Holding price refresh crashed",
      expect.objectContaining({ level: "error" }),
    );
  });
});
