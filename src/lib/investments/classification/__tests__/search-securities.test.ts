import { describe, it, expect } from "vitest";
import { searchSecurities } from "../search-securities";
import type { LiveQuote } from "@/lib/portal/contracts";

// EODHD /search row shape (only the fields the picker reads).
const hit = (Code: string, Exchange: string, Type: string, Name: string) => ({
  Code, Exchange, Type, Name,
});
const yields = (payload: unknown, calls?: string[]) => (q: string) => {
  calls?.push(q);
  return Promise.resolve(payload);
};
/** A feed that answers only the listed queries and returns nothing for the
 *  rest — which is how EODHD behaves for a statement's own spelling. */
const answers = (byQuery: Record<string, unknown>, calls?: string[]) => (q: string) => {
  calls?.push(q);
  return Promise.resolve(byQuery[q] ?? []);
};
const quote = (price: number): LiveQuote => ({ price, changePct: null, asOf: "2026-09-16" });

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
    expect(res.relaxedTo).toBeNull();
    expect(res.hits).toEqual([
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
    // US first is the hard partition. Order WITHIN the foreign group is match
    // score now, not EODHD's own order — a deliberate trade: ranking names
    // correctly is worth more than preserving the feed's ordering of listings
    // the advisor is unlikely to want in the first place.
    expect(res.hits[0].ticker).toBe("IBM");
    expect(res.hits.slice(1).map((r) => r.ticker).sort()).toEqual(["IBM.BA", "IBM.XETRA"]);
  });

  it("suffixes a foreign listing so the quote lookup still resolves it", async () => {
    // `eodhdSymbol` passes an explicit exchange suffix through untouched; a bare
    // "BMW" would be rewritten to BMW.US and price the wrong thing (or nothing).
    const res = await searchSecurities("BMW", {
      search: yields([hit("BMW", "XETRA", "Common Stock", "Bayerische Motoren Werke AG")]),
    });
    expect(res.hits[0].ticker).toBe("BMW.XETRA");
  });

  it("keeps one row per symbol when EODHD repeats a listing", async () => {
    const res = await searchSecurities("SGOV", {
      search: yields([
        hit("SGOV", "US", "ETF", "iShares 0-3 Month Treasury Bond ETF"),
        hit("SGOV", "US", "ETF", "iShares 0-3 Month Treasury Bond ETF"),
      ]),
    });
    expect(res.hits).toHaveLength(1);
  });

  it("caps the list at ten so the picker stays readable", async () => {
    const res = await searchSecurities("fund", {
      search: yields(
        Array.from({ length: 25 }, (_, i) => hit(`F${i}`, "US", "FUND", `Fund ${i}`)),
      ),
    });
    expect(res.hits).toHaveLength(10);
  });

  it("skips rows with no usable name or code", async () => {
    const res = await searchSecurities("junk", {
      search: yields([
        { Code: "OK", Exchange: "US", Type: "ETF", Name: "Fine ETF" },
        { Code: "NONAME", Exchange: "US", Type: "ETF", Name: "   " },
        { Exchange: "US", Type: "ETF", Name: "No code" },
      ]),
    });
    expect(res.hits.map((r) => r.ticker)).toEqual(["OK"]);
  });

  it("does not call the feed for a one-character query", async () => {
    const calls: string[] = [];
    const res = await searchSecurities("v", { search: yields([], calls) });
    expect(calls).toEqual([]);
    expect(res.hits).toEqual([]);
  });

  it("throws when the feed fails, so the picker can't report it as 'no matches'", async () => {
    await expect(
      searchSecurities("vanguard", {
        search: () => Promise.reject(new Error("HTTP 402")),
      }),
    ).rejects.toThrow("HTTP 402");
  });

  describe("when the statement's own spelling finds nothing", () => {
    // The real untickered holding behind this: EODHD indexes the fund as
    // "…INSTITUTIONAL SHARES", so the statement's "Instl Class" matches no row
    // at all and the advisor is told nothing exists.
    const feed = {
      "vanguard small cap growth index institutional": [
        hit("VISGX", "US", "FUND", "VANGUARD SMALL-CAP GROWTH INDEX FUND INVESTOR SHARES"),
        hit("VSGIX", "US", "FUND", "VANGUARD SMALL-CAP GROWTH INDEX FUND INSTITUTIONAL SHARES"),
      ],
    };
    const typed = "Vanguard Small Cap Growth Index Fund Instl Class";

    it("widens the query until the feed answers", async () => {
      const res = await searchSecurities(typed, { search: answers(feed) });
      expect(res.hits.map((h) => h.ticker)).toContain("VSGIX");
    });

    it("says which query it fell back to", async () => {
      const res = await searchSecurities(typed, { search: answers(feed) });
      expect(res.relaxedTo).toBe("vanguard small cap growth index institutional");
    });

    it("still leads with the share class the statement named", async () => {
      // The point of ranking against the ORIGINAL name: "Instl" is dropped to
      // get any rows back, then used to choose between them. Without this the
      // Investor share class wins on EODHD's own order and the advisor saves
      // the wrong fund.
      const res = await searchSecurities(typed, { search: answers(feed) });
      expect(res.hits[0].ticker).toBe("VSGIX");
    });

    it("costs exactly one call when the typed name works on its own", async () => {
      const calls: string[] = [];
      await searchSecurities("vanguard total stock market", {
        search: answers(
          { "vanguard total stock market": [hit("VTI", "US", "ETF", "Vanguard Total Stock Market ETF")] },
          calls,
        ),
      });
      expect(calls).toHaveLength(1);
    });

    it("gives up rather than widening to something unrecognisable", async () => {
      // A collective trust that genuinely isn't in the index. Answering with
      // "every Galliard product" would be worse than an empty list.
      const calls: string[] = [];
      const res = await searchSecurities("Galliard Stable Return Fund Class Q", {
        search: answers({}, calls),
      });
      expect(res.hits).toEqual([]);
      expect(res.relaxedTo).toBeNull();
      expect(calls.length).toBeLessThanOrEqual(5);
    });
  });

  describe("prices", () => {
    it("shows the latest close beside each match", async () => {
      const res = await searchSecurities("vanguard total stock market", {
        search: yields([hit("VTI", "US", "ETF", "Vanguard Total Stock Market ETF")]),
        quotes: async () => new Map([["VTI.US", quote(291.34)]]),
      });
      expect(res.hits[0].price).toBe(291.34);
    });

    it("leaves a row UNPRICED rather than showing $0 when the feed can't answer", async () => {
      // The live failure mode this guards: the quote entitlement lapsed and
      // every symbol came back empty for a week. A price of 0 would read as a
      // worthless security; an absent price reads as "we don't know".
      const res = await searchSecurities("vanguard total stock market", {
        search: yields([hit("VTI", "US", "ETF", "Vanguard Total Stock Market ETF")]),
        quotes: async () => new Map(),
      });
      expect(res.hits[0].price).toBeUndefined();
    });

    it("prices a foreign listing under its suffixed symbol", async () => {
      const res = await searchSecurities("BMW", {
        search: yields([hit("BMW", "XETRA", "Common Stock", "Bayerische Motoren Werke AG")]),
        quotes: async () => new Map([["BMW.XETRA", quote(88.2)]]),
      });
      expect(res.hits[0].price).toBe(88.2);
    });

    it("keeps the rows when the quote lookup returns nothing at all", async () => {
      const res = await searchSecurities("IBM", {
        search: yields([hit("IBM", "US", "Common Stock", "International Business Machines")]),
        quotes: async () => new Map(),
      });
      expect(res.hits).toHaveLength(1);
    });

    it("prices a match from the search row itself, with no quote call at all", async () => {
      // `/search` rows carry their own dated previousClose, and it is on a
      // different entitlement than the quote feeds — which is the only reason
      // anything is priced at all right now. Free: the number is already here.
      const asked: string[] = [];
      const res = await searchSecurities("vanguard small cap growth instl", {
        search: yields([{
          ...hit("VSGIX", "US", "FUND", "VANGUARD SMALL-CAP GROWTH INDEX FUND INSTITUTIONAL SHARES"),
          previousClose: 94.31,
          previousCloseDate: "2026-09-16",
        }]),
        quotes: async (tickers) => { asked.push(...tickers); return new Map(); },
      });
      expect(res.hits[0].price).toBe(94.31);
      expect(asked).toEqual([]);
    });

    it("still quotes the rows the search feed gave no close for", async () => {
      const asked: string[] = [];
      const res = await searchSecurities("index fund", {
        search: yields([
          { ...hit("VSGIX", "US", "FUND", "Vanguard Small-Cap Growth Index Instl"), previousClose: 94.31, previousCloseDate: "2026-09-16" },
          hit("VTSAX", "US", "FUND", "Vanguard Total Stock Market Index Admiral"),
        ]),
        quotes: async (tickers) => {
          asked.push(...tickers);
          return new Map([["VTSAX.US", quote(151.2)]]);
        },
      });
      expect(asked).toEqual(["VTSAX"]);
      expect(res.hits.map((h) => h.price)).toEqual([94.31, 151.2]);
    });

    it("ignores an unusable close rather than showing the row at $0", async () => {
      const res = await searchSecurities("dead fund", {
        search: yields([{
          ...hit("ZZZZ", "US", "FUND", "Dead Fund"),
          previousClose: 0,
          previousCloseDate: "2026-09-16",
        }]),
        quotes: async () => new Map(),
      });
      expect(res.hits[0].price).toBeUndefined();
    });

    it("never fetches a live quote when the search transport is injected", async () => {
      // vitest loads .env.local, so a real EODHD key IS present under test. If
      // pricing defaulted to live, every search test above would hit the paid
      // feed. Proven by the absence of a price, with no quotes dep passed.
      const res = await searchSecurities("IBM", {
        search: yields([hit("IBM", "US", "Common Stock", "International Business Machines")]),
      });
      expect(res.hits[0].price).toBeUndefined();
    });
  });
});
