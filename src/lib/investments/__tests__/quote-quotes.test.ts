// src/lib/investments/__tests__/quote-quotes.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchEodQuotes, eodhdSymbol } from "../quote";

describe("fetchEodQuotes", () => {
  it("maps close + change_p + timestamp into LiveQuote", async () => {
    const fetchRealtime = vi.fn(async () => [
      { code: "VTI.US", close: 280.5, change_p: 1.23, timestamp: 1750636800 },
      { code: "GLD.US", close: 390.78, change_p: -5.6, timestamp: 1750636800 },
    ]);
    const out = await fetchEodQuotes(["VTI", "GLD"], { fetchRealtime });
    expect(out.get(eodhdSymbol("VTI"))).toMatchObject({ price: 280.5, changePct: 1.23 });
    expect(out.get(eodhdSymbol("VTI"))!.asOf).toBe(new Date(1750636800 * 1000).toISOString().slice(0, 10));
    expect(out.get(eodhdSymbol("GLD"))!.changePct).toBeCloseTo(-5.6);
  });
  it("returns an empty map on fetch error (fail-soft)", async () => {
    const fetchRealtime = vi.fn(async () => { throw new Error("boom"); });
    expect((await fetchEodQuotes(["VTI"], { fetchRealtime })).size).toBe(0);
  });
});
