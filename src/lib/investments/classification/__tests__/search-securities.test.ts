import { describe, it, expect } from "vitest";
import { searchSecurities } from "../search-securities";

// EODHD /search row shape (only the fields the picker reads).
const hit = (Code: string, Exchange: string, Type: string, Name: string) => ({
  Code, Exchange, Type, Name,
});
const yields = (payload: unknown, calls?: string[]) => (q: string) => {
  calls?.push(q);
  return Promise.resolve(payload);
};

describe("searchSecurities", () => {
  it("finds a fund from its name when the statement gave no ticker", async () => {
    const calls: string[] = [];
    const res = await searchSecurities("vanguard total stock market", {
      search: yields(
        [hit("VTSAX", "US", "FUND", "Vanguard Total Stock Market Index Fund Admiral Shares")],
        calls,
      ),
    });
    expect(calls).toEqual(["vanguard total stock market"]);
    expect(res).toEqual([
      {
        ticker: "VTSAX",
        name: "Vanguard Total Stock Market Index Fund Admiral Shares",
        exchange: "US",
        securityType: "mutual_fund",
      },
    ]);
  });

  it("puts US listings first — every other listing comes back unpriced", async () => {
    const res = await searchSecurities("IBM", {
      search: yields([
        hit("IBM", "BA", "Common Stock", "International Business Machines Corporation"),
        hit("IBM", "XETRA", "Common Stock", "International Business Machines"),
        hit("IBM", "US", "Common Stock", "International Business Machines Corp"),
      ]),
    });
    expect(res.map((r) => r.ticker)).toEqual(["IBM", "IBM.BA", "IBM.XETRA"]);
  });

  it("suffixes a foreign listing so the quote lookup still resolves it", async () => {
    // `eodhdSymbol` passes an explicit exchange suffix through untouched; a bare
    // "BMW" would be rewritten to BMW.US and price the wrong thing (or nothing).
    const res = await searchSecurities("BMW", {
      search: yields([hit("BMW", "XETRA", "Common Stock", "Bayerische Motoren Werke AG")]),
    });
    expect(res[0].ticker).toBe("BMW.XETRA");
  });

  it("keeps one row per symbol when EODHD repeats a listing", async () => {
    const res = await searchSecurities("SGOV", {
      search: yields([
        hit("SGOV", "US", "ETF", "iShares 0-3 Month Treasury Bond ETF"),
        hit("SGOV", "US", "ETF", "iShares 0-3 Month Treasury Bond ETF"),
      ]),
    });
    expect(res).toHaveLength(1);
  });

  it("caps the list at ten so the picker stays readable", async () => {
    const res = await searchSecurities("fund", {
      search: yields(
        Array.from({ length: 25 }, (_, i) => hit(`F${i}`, "US", "FUND", `Fund ${i}`)),
      ),
    });
    expect(res).toHaveLength(10);
  });

  it("skips rows with no usable name or code", async () => {
    const res = await searchSecurities("junk", {
      search: yields([
        { Code: "OK", Exchange: "US", Type: "ETF", Name: "Fine ETF" },
        { Code: "NONAME", Exchange: "US", Type: "ETF", Name: "   " },
        { Exchange: "US", Type: "ETF", Name: "No code" },
      ]),
    });
    expect(res.map((r) => r.ticker)).toEqual(["OK"]);
  });

  it("does not call the feed for a one-character query", async () => {
    const calls: string[] = [];
    const res = await searchSecurities("v", { search: yields([], calls) });
    expect(calls).toEqual([]);
    expect(res).toEqual([]);
  });

  it("throws when the feed fails, so the picker can't report it as 'no matches'", async () => {
    await expect(
      searchSecurities("vanguard", {
        search: () => Promise.reject(new Error("HTTP 402")),
      }),
    ).rejects.toThrow("HTTP 402");
  });
});
