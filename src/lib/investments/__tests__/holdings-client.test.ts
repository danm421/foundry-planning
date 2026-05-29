import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listHoldings, createHolding, updateHolding, deleteHolding,
  setHoldingOverride, classifyTicker, setAccountGrowthSource, getQuote,
} from "../holdings-client";

function mockFetch(status: number, json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  } as Response);
}

beforeEach(() => { vi.restoreAllMocks(); });

const C = "c1", A = "a1", H = "h1";

describe("holdings-client", () => {
  it("listHoldings GETs the enriched list", async () => {
    const f = mockFetch(200, [{ id: "h1", securityWeights: [], overrides: [], needsReview: true }]);
    vi.stubGlobal("fetch", f);
    const rows = await listHoldings(C, A);
    expect(f).toHaveBeenCalledWith(`/api/clients/${C}/accounts/${A}/holdings`);
    expect(rows[0].id).toBe("h1");
  });

  it("createHolding POSTs the body and returns the row", async () => {
    const f = mockFetch(201, { id: "h9" });
    vi.stubGlobal("fetch", f);
    const row = await createHolding(C, A, { displayTicker: "VTI", shares: 1, price: 2, costBasis: 0 });
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe(`/api/clients/${C}/accounts/${A}/holdings`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).displayTicker).toBe("VTI");
    expect(row.id).toBe("h9");
  });

  it("updateHolding PUTs a partial patch", async () => {
    const f = mockFetch(200, { id: H, price: "99" });
    vi.stubGlobal("fetch", f);
    await updateHolding(C, A, H, { price: 99 });
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe(`/api/clients/${C}/accounts/${A}/holdings/${H}`);
    expect(opts.method).toBe("PUT");
  });

  it("deleteHolding DELETEs", async () => {
    const f = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", f);
    await deleteHolding(C, A, H);
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });

  it("setHoldingOverride PUTs the overrides array (empty clears)", async () => {
    const f = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", f);
    await setHoldingOverride(C, A, H, []);
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe(`/api/clients/${C}/accounts/${A}/holdings/${H}/override`);
    expect(JSON.parse(opts.body)).toEqual({ overrides: [] });
  });

  it("classifyTicker POSTs the ticker and returns security+weights", async () => {
    const f = mockFetch(200, { security: { id: "s1" }, weights: [{ slug: "us_large_cap", weight: 1 }] });
    vi.stubGlobal("fetch", f);
    const r = await classifyTicker(C, A, "vti");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ ticker: "vti" });
    expect(r.security?.id).toBe("s1");
  });

  it("classifyTicker returns the fail-soft null shape without throwing", async () => {
    const f = mockFetch(200, { security: null, weights: [] });
    vi.stubGlobal("fetch", f);
    const r = await classifyTicker(C, A, "ZZZZ");
    expect(r.security).toBeNull();
    expect(r.weights).toEqual([]);
  });

  it("setAccountGrowthSource PUTs { growthSource } to the account route", async () => {
    const f = mockFetch(200, { id: A, growthSource: "asset_mix" });
    vi.stubGlobal("fetch", f);
    await setAccountGrowthSource(C, A, "asset_mix");
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe(`/api/clients/${C}/accounts/${A}`);
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ growthSource: "asset_mix" });
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { error: "boom" }));
    await expect(listHoldings(C, A)).rejects.toThrow();
  });
});

describe("getQuote", () => {
  it("GETs the quote endpoint with the ticker query and returns price + asOf", async () => {
    const f = mockFetch(200, { price: 201.5, asOf: "2026-05-28" });
    vi.stubGlobal("fetch", f);
    const q = await getQuote(C, A, "AAPL");
    expect(f).toHaveBeenCalledWith(
      `/api/clients/${C}/accounts/${A}/holdings/quote?ticker=AAPL`,
    );
    expect(q).toEqual({ price: 201.5, asOf: "2026-05-28" });
  });

  it("returns null when the route reports a miss ({ price: null })", async () => {
    const f = mockFetch(200, { price: null });
    vi.stubGlobal("fetch", f);
    expect(await getQuote(C, A, "ZZZZ")).toBeNull();
  });

  it("returns null on a transport error instead of throwing", async () => {
    const f = mockFetch(500, { error: "boom" });
    vi.stubGlobal("fetch", f);
    expect(await getQuote(C, A, "AAPL")).toBeNull();
  });
});
