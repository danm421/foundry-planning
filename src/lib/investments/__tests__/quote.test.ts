import { describe, it, expect } from "vitest";
import { fetchEodClose, eodSymbol } from "../quote";

describe("eodSymbol", () => {
  it("appends .US to a bare ticker", () => {
    expect(eodSymbol("AAPL")).toBe("AAPL.US");
    expect(eodSymbol("vti")).toBe("VTI.US");
  });
  it("passes through a ticker that already carries an exchange suffix", () => {
    expect(eodSymbol("BMW.XETRA")).toBe("BMW.XETRA");
  });
});

describe("fetchEodClose", () => {
  // The injected fetcher returns parsed EODHD /eod JSON directly (the live
  // fetchEodLive does the fetch + ok-check + .json()).
  const ok = (body: unknown) => () => Promise.resolve(body);

  it("returns the most recent close + date on success", async () => {
    const res = await fetchEodClose("AAPL", {
      fetchEod: ok([{ date: "2026-05-28", close: 201.5 }]),
    });
    expect(res).toEqual({ price: 201.5, asOf: "2026-05-28" });
  });

  it("returns null for an unknown ticker (empty array)", async () => {
    const res = await fetchEodClose("ZZZZ", { fetchEod: ok([]) });
    expect(res).toBeNull();
  });

  it("returns null on a malformed payload", async () => {
    const res = await fetchEodClose("AAPL", { fetchEod: ok({ nope: true }) });
    expect(res).toBeNull();
  });

  it("returns null when the fetcher throws (HTTP/network error)", async () => {
    const res = await fetchEodClose("AAPL", {
      fetchEod: () => Promise.reject(new Error("HTTP 500")),
    });
    expect(res).toBeNull();
  });

  it("returns null when close is not a finite number", async () => {
    const res = await fetchEodClose("AAPL", {
      fetchEod: ok([{ date: "2026-05-28", close: "n/a" }]),
    });
    expect(res).toBeNull();
  });
});
