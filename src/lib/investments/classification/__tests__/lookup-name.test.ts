import { describe, it, expect } from "vitest";
import { lookupSecurityName } from "../lookup-name";

// EODHD /search row shape (only the fields the picker reads).
const hit = (Code: string, Exchange: string, Type: string, Name: string) => ({
  Code, Exchange, Type, Name,
});
const yields = (payload: unknown, calls?: string[]) => (q: string) => {
  calls?.push(q);
  return Promise.resolve(payload);
};

describe("lookupSecurityName", () => {
  it("names a mutual fund the fundamentals feed can't reach", async () => {
    const res = await lookupSecurityName("SWPPX", {
      search: yields([hit("SWPPX", "US", "FUND", "Schwab S&P 500 Index Fund")]),
    });
    expect(res).toEqual({ name: "Schwab S&P 500 Index Fund", securityType: "mutual_fund" });
  });

  it("picks the listing our symbol names, not merely the first row", async () => {
    // `search/IBM` answers with every exchange IBM trades on; taking row 0 on
    // faith would eventually attach a foreign listing's name to a US holding.
    const res = await lookupSecurityName("IBM", {
      search: yields([
        hit("IBM", "BA", "Common Stock", "International Business Machines Corporation"),
        hit("IBM", "XETRA", "Common Stock", "International Business Machines"),
        hit("IBM", "US", "Common Stock", "International Business Machines"),
      ]),
    });
    expect(res).toEqual({ name: "International Business Machines", securityType: "stock" });
  });

  it("searches on the resolved EODHD code for a class share", async () => {
    const calls: string[] = [];
    const res = await lookupSecurityName("BRK.B", {
      search: yields([hit("BRK-B", "US", "Common Stock", "Berkshire Hathaway Inc")], calls),
    });
    expect(calls).toEqual(["BRK-B"]);
    expect(res?.name).toBe("Berkshire Hathaway Inc");
  });

  it("maps an ETF row to the etf type", async () => {
    const res = await lookupSecurityName("SGOV", {
      search: yields([hit("SGOV", "US", "ETF", "iShares 0-3 Month Treasury Bond ETF")]),
    });
    expect(res?.securityType).toBe("etf");
  });

  it("returns null when nothing matches the exchange", async () => {
    const res = await lookupSecurityName("IBM", {
      search: yields([hit("IBM", "XETRA", "Common Stock", "International Business Machines")]),
    });
    expect(res).toBeNull();
  });

  it("returns null for an unknown ticker (empty result set)", async () => {
    expect(await lookupSecurityName("ZZZNOTREAL", { search: yields([]) })).toBeNull();
  });

  it("returns null — never throws — when the search transport fails", async () => {
    const res = await lookupSecurityName("SWPPX", {
      search: () => Promise.reject(new Error("HTTP 503")),
    });
    expect(res).toBeNull();
  });

  it("ignores a row with a blank name", async () => {
    const res = await lookupSecurityName("SWPPX", {
      search: yields([hit("SWPPX", "US", "FUND", "   ")]),
    });
    expect(res).toBeNull();
  });
});
