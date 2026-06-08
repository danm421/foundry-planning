import { describe, it, expect } from "vitest";
import { fetchEodClose, fetchEodCloses, eodhdSymbol, type QuoteDeps } from "../quote";

// EODHD real-time row shape (only the fields the parser reads).
const tsFor = (date: string) => Math.floor(Date.parse(`${date}T16:00:00Z`) / 1000);
const row = (code: string, date: string, close: number | string) => ({
  code,
  timestamp: date === "NA" ? "NA" : tsFor(date),
  close,
});
// Returns a fetcher that always yields `payload` (object or array), recording calls.
const yields = (payload: unknown, calls?: string[][]): QuoteDeps["fetchRealtime"] =>
  (symbols) => {
    calls?.push(symbols);
    return Promise.resolve(payload);
  };

describe("eodhdSymbol", () => {
  it("appends .US to a bare ticker (upper-cased)", () => {
    expect(eodhdSymbol("AAPL")).toBe("AAPL.US");
    expect(eodhdSymbol("vti")).toBe("VTI.US");
  });
  it("maps a US class-share dot to a dash", () => {
    expect(eodhdSymbol("BRK.B")).toBe("BRK-B.US");
    expect(eodhdSymbol("bf.b")).toBe("BF-B.US");
  });
  it("passes a foreign exchange suffix through (upper-cased)", () => {
    expect(eodhdSymbol("BMW.XETRA")).toBe("BMW.XETRA");
  });
});

describe("fetchEodClose (single)", () => {
  it("returns the close + date for the requested ticker (single-object response)", async () => {
    const res = await fetchEodClose("AAPL", {
      fetchRealtime: yields(row("AAPL.US", "2026-05-28", 201.5)),
    });
    expect(res).toEqual({ price: 201.5, asOf: "2026-05-28" });
  });

  it("returns null for an NA (unknown) row", async () => {
    const res = await fetchEodClose("ZZZZ", {
      fetchRealtime: yields(row("ZZZZ.US", "NA", "NA")),
    });
    expect(res).toBeNull();
  });

  it("returns null when the fetcher throws", async () => {
    const res = await fetchEodClose("AAPL", {
      fetchRealtime: () => Promise.reject(new Error("HTTP 500")),
    });
    expect(res).toBeNull();
  });
});

describe("fetchEodCloses (batch)", () => {
  it("parses multiple rows keyed by upper-case EODHD code", async () => {
    const res = await fetchEodCloses(["AAPL", "VTI", "BRK.B"], {
      fetchRealtime: yields([
        row("AAPL.US", "2026-05-29", 312.06),
        row("VTI.US", "2026-05-29", 372.54),
        row("BRK-B.US", "2026-05-29", 640.1),
      ]),
    });
    expect(res.get("AAPL.US")).toEqual({ price: 312.06, asOf: "2026-05-29" });
    expect(res.get("BRK-B.US")).toEqual({ price: 640.1, asOf: "2026-05-29" });
    expect(res.size).toBe(3);
  });

  it("excludes NA rows", async () => {
    const res = await fetchEodCloses(["VTI", "ZZZZ"], {
      fetchRealtime: yields([
        row("VTI.US", "2026-05-29", 372.54),
        row("ZZZZ.US", "NA", "NA"),
      ]),
    });
    expect(res.has("VTI.US")).toBe(true);
    expect(res.has("ZZZZ.US")).toBe(false);
  });

  it("chunks symbols at 50 per request", async () => {
    const tickers = Array.from({ length: 120 }, (_, i) => `T${i}`);
    const calls: string[][] = [];
    await fetchEodCloses(tickers, { fetchRealtime: yields([], calls) });
    expect(calls.length).toBe(3); // 50 + 50 + 20
    expect(calls[0].length).toBe(50);
  });

  it("retries a throwing chunk once, then keeps its result", async () => {
    let n = 0;
    const res = await fetchEodCloses(["VTI"], {
      fetchRealtime: () => {
        n += 1;
        if (n === 1) return Promise.reject(new Error("HTTP 503"));
        return Promise.resolve([row("VTI.US", "2026-05-29", 372.54)]);
      },
    });
    expect(n).toBe(2);
    expect(res.get("VTI.US")).toEqual({ price: 372.54, asOf: "2026-05-29" });
  });

  it("drops a chunk that fails twice but keeps the rest", async () => {
    const res = await fetchEodCloses(["VTI"], {
      fetchRealtime: () => Promise.reject(new Error("HTTP 503")),
    });
    expect(res.size).toBe(0); // failed both attempts, skipped — no throw
  });

  it("returns empty (never throws) when no API key is configured", async () => {
    const prev = process.env.EODHD_API_KEY;
    delete process.env.EODHD_API_KEY;
    try {
      const res = await fetchEodCloses(["VTI"]); // no injected fetcher, no key
      expect(res.size).toBe(0);
    } finally {
      if (prev !== undefined) process.env.EODHD_API_KEY = prev;
    }
  });
});
