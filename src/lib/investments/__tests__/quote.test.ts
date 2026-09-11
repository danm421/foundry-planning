import { describe, it, expect, vi } from "vitest";
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

  it("redirects a foreign primary listing to its USD ADR line", () => {
    // Bare `ABB`/`WKL` have no `.US` listing at all, so the default `.US`
    // suffix returns nothing (or, for WKL, a dead same-code instrument).
    expect(eodhdSymbol("ABB")).toBe("ABBNY.US");
    expect(eodhdSymbol("WKL")).toBe("WTKWY.US");
    expect(eodhdSymbol("imcd")).toBe("IMCDY.US");
  });

  it("leaves an explicit exchange suffix alone even for a mapped ticker", () => {
    // The map keys bare tickers only — someone who typed the Amsterdam line
    // meant it, and must not be silently rerouted to the ADR.
    expect(eodhdSymbol("IMCD.AS")).toBe("IMCD.AS");
  });

  it("does not touch tickers that resolve correctly on .US", () => {
    expect(eodhdSymbol("VTI")).toBe("VTI.US");
    expect(eodhdSymbol("ASM")).toBe("ASM.US"); // genuinely US-listed
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

  it("warns distinctly when no API key is configured (instead of silently null)", async () => {
    const prev = process.env.EODHD_API_KEY;
    delete process.env.EODHD_API_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await fetchEodClose("VTI"); // no injected fetcher, no key
      expect(res).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("EODHD_API_KEY"));
    } finally {
      warn.mockRestore();
      if (prev !== undefined) process.env.EODHD_API_KEY = prev;
    }
  });

  it("does NOT warn about a missing key when a transport error occurs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await fetchEodClose("AAPL", {
        fetchRealtime: () => Promise.reject(new Error("HTTP 500")),
      });
      expect(res).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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

// A mutual fund doesn't strike its NAV until after the close, so EODHD's
// real-time feed answers `"NA"` for it through the whole trading day. The
// last-day fallback is what keeps those funds priced — see fetchLastDay.
const lastDayRow = (code: string, date: string, close: number | string) => ({
  code,
  exchange_short_name: date === "NA" ? "NA" : "US",
  date,
  close,
});
const yieldsLastDay = (payload: unknown, calls?: string[][]): QuoteDeps["fetchLastDay"] =>
  (codes) => {
    calls?.push(codes);
    return Promise.resolve(payload);
  };

describe("last-day fallback for symbols the real-time feed can't price", () => {
  it("prices a mutual fund whose real-time close is NA", async () => {
    const res = await fetchEodClose("SWCGX", {
      fetchRealtime: yields(row("SWCGX.US", "NA", "NA")),
      fetchLastDay: yieldsLastDay([lastDayRow("SWCGX", "2026-09-09", 16.32)]),
    });
    expect(res).toEqual({ price: 16.32, asOf: "2026-09-09" });
  });

  it("still returns null when the fallback can't price it either", async () => {
    const res = await fetchEodClose("ZZZZ", {
      fetchRealtime: yields(row("ZZZZ.US", "NA", "NA")),
      fetchLastDay: yieldsLastDay([lastDayRow("ZZZZ", "NA", "NA")]),
    });
    expect(res).toBeNull();
  });

  it("fills only the unpriced symbols, in one fallback call", async () => {
    const calls: string[][] = [];
    const res = await fetchEodCloses(["IBM", "SWCGX", "VTINX"], {
      fetchRealtime: yields([
        row("IBM.US", "2026-09-10", 234.02),
        row("SWCGX.US", "NA", "NA"),
        row("VTINX.US", "NA", "NA"),
      ]),
      fetchLastDay: yieldsLastDay(
        [lastDayRow("SWCGX", "2026-09-09", 16.32), lastDayRow("VTINX", "2026-09-09", 14.31)],
        calls,
      ),
    });
    // The fallback is asked only about what real-time missed, and asked once.
    expect(calls).toEqual([["SWCGX", "VTINX"]]);
    // A live real-time price is never overwritten by the older daily close.
    expect(res.get("IBM.US")).toEqual({ price: 234.02, asOf: "2026-09-10" });
    expect(res.get("SWCGX.US")).toEqual({ price: 16.32, asOf: "2026-09-09" });
    expect(res.get("VTINX.US")).toEqual({ price: 14.31, asOf: "2026-09-09" });
  });

  it("does not call the fallback when real-time priced everything", async () => {
    const calls: string[][] = [];
    await fetchEodCloses(["IBM"], {
      fetchRealtime: yields([row("IBM.US", "2026-09-10", 234.02)]),
      fetchLastDay: yieldsLastDay([], calls),
    });
    expect(calls).toEqual([]);
  });

  it("never sends a non-US listing to the fallback (it is a US-exchange feed)", async () => {
    const calls: string[][] = [];
    const res = await fetchEodCloses(["BMW.XETRA", "SWCGX"], {
      fetchRealtime: yields([]),
      fetchLastDay: yieldsLastDay([lastDayRow("SWCGX", "2026-09-09", 16.32)], calls),
    });
    expect(calls).toEqual([["SWCGX"]]);
    expect(res.has("BMW.XETRA")).toBe(false);
  });

  it("keeps the real-time results when the fallback throws", async () => {
    const res = await fetchEodCloses(["IBM", "SWCGX"], {
      fetchRealtime: yields([
        row("IBM.US", "2026-09-10", 234.02),
        row("SWCGX.US", "NA", "NA"),
      ]),
      fetchLastDay: () => Promise.reject(new Error("HTTP 503")),
    });
    expect(res.get("IBM.US")).toEqual({ price: 234.02, asOf: "2026-09-10" });
    expect(res.size).toBe(1);
  });

  it("does not reach the network when only fetchRealtime is injected", async () => {
    // Guards every existing test in this file: an injected transport means the
    // caller is driving the whole thing, so no live fallback may fire.
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      const res = await fetchEodCloses(["SWCGX"], {
        fetchRealtime: yields([row("SWCGX.US", "NA", "NA")]),
      });
      expect(spy).not.toHaveBeenCalled();
      expect(res.size).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
