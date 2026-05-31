import { describe, it, expect } from "vitest";
import { fetchEodClose, fetchEodCloses, stooqSymbol } from "../quote";

const HEADER = "Symbol,Date,Time,Open,High,Low,Close,Volume";
const row = (sym: string, date: string, close: string) =>
  `${sym},${date},22:00:00,0,0,0,${close},0`;

describe("stooqSymbol", () => {
  it("appends .us to a bare ticker (lower-cased)", () => {
    expect(stooqSymbol("AAPL")).toBe("aapl.us");
    expect(stooqSymbol("vti")).toBe("vti.us");
  });
  it("maps a US class share dot to a dash", () => {
    expect(stooqSymbol("BRK.B")).toBe("brk-b.us");
    expect(stooqSymbol("bf.b")).toBe("bf-b.us");
  });
  it("passes a foreign exchange suffix through lower-cased", () => {
    expect(stooqSymbol("BMW.XETRA")).toBe("bmw.xetra");
  });
});

describe("fetchEodClose (single)", () => {
  const ok = (csv: string) => () => Promise.resolve(csv);

  it("returns the close + date for the requested ticker", async () => {
    const res = await fetchEodClose("AAPL", {
      fetchCsv: ok(`${HEADER}\n${row("AAPL.US", "2026-05-28", "201.5")}`),
    });
    expect(res).toEqual({ price: 201.5, asOf: "2026-05-28" });
  });

  it("returns null for an N/D (unknown) row", async () => {
    const res = await fetchEodClose("ZZZZ", {
      fetchCsv: ok(`${HEADER}\n${row("ZZZZ.US", "N/D", "N/D")}`),
    });
    expect(res).toBeNull();
  });

  it("returns null when the fetcher throws", async () => {
    const res = await fetchEodClose("AAPL", {
      fetchCsv: () => Promise.reject(new Error("HTTP 500")),
    });
    expect(res).toBeNull();
  });
});

describe("fetchEodCloses (batch)", () => {
  it("parses multiple rows keyed by upper-case Stooq symbol", async () => {
    const csv = [
      HEADER,
      row("AAPL.US", "2026-05-29", "312.06"),
      row("VTI.US", "2026-05-29", "372.54"),
      row("BRK-B.US", "2026-05-29", "640.1"),
    ].join("\n");
    const res = await fetchEodCloses(["AAPL", "VTI", "BRK.B"], {
      fetchCsv: () => Promise.resolve(csv),
    });
    expect(res.get("AAPL.US")).toEqual({ price: 312.06, asOf: "2026-05-29" });
    expect(res.get("BRK-B.US")).toEqual({ price: 640.1, asOf: "2026-05-29" });
    expect(res.size).toBe(3);
  });

  it("excludes N/D rows", async () => {
    const csv = [
      HEADER,
      row("VTI.US", "2026-05-29", "372.54"),
      row("ZZZZ.US", "N/D", "N/D"),
    ].join("\n");
    const res = await fetchEodCloses(["VTI", "ZZZZ"], {
      fetchCsv: () => Promise.resolve(csv),
    });
    expect(res.has("VTI.US")).toBe(true);
    expect(res.has("ZZZZ.US")).toBe(false);
  });

  it("chunks symbols at 50 per request", async () => {
    const tickers = Array.from({ length: 120 }, (_, i) => `T${i}`);
    const queries: string[] = [];
    await fetchEodCloses(tickers, {
      fetchCsv: (q) => {
        queries.push(q);
        return Promise.resolve(HEADER); // header-only is fine for this assertion
      },
    });
    expect(queries.length).toBe(3); // 50 + 50 + 20
    expect(queries[0].split("+").length).toBe(50);
  });

  it("retries a throwing chunk once, then skips it without failing the batch", async () => {
    let calls = 0;
    const csv = `${HEADER}\n${row("VTI.US", "2026-05-29", "372.54")}`;
    const res = await fetchEodCloses(["VTI"], {
      fetchCsv: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("HTTP 503"));
        return Promise.resolve(csv);
      },
    });
    expect(calls).toBe(2);
    expect(res.get("VTI.US")).toEqual({ price: 372.54, asOf: "2026-05-29" });
  });

  it("drops a chunk that fails twice but keeps the rest", async () => {
    const res = await fetchEodCloses(["VTI"], {
      fetchCsv: () => Promise.reject(new Error("HTTP 503")),
    });
    expect(res.size).toBe(0); // failed both attempts, skipped — no throw
  });
});
