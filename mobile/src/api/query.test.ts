// mobile/src/api/query.test.ts
import { describe, it, expect } from "vitest";
import { buildTransactionsQuery, buildQuotesQuery, buildRecurringPreviewQuery } from "./query";

describe("buildTransactionsQuery", () => {
  it("omits empty/undefined params", () => {
    expect(buildTransactionsQuery({ limit: 50, offset: 0 })).toBe("?limit=50&offset=0");
  });
  it("includes set filters and url-encodes q", () => {
    const qs = buildTransactionsQuery({ limit: 50, offset: 50, q: "whole foods", categoryId: "cat1", reviewed: false });
    expect(qs).toContain("offset=50");
    expect(qs).toContain("q=whole%20foods");
    expect(qs).toContain("categoryId=cat1");
    expect(qs).toContain("reviewed=false");
  });
  it("emits accountId + from when present", () => {
    const qs = buildTransactionsQuery({ limit: 50, offset: 0, accountId: "a1", from: "2026-01-01" });
    expect(qs).toContain("accountId=a1");
    expect(qs).toContain("from=2026-01-01");
  });
});

describe("buildQuotesQuery", () => {
  it("returns empty string for no tickers", () => {
    expect(buildQuotesQuery([])).toBe("");
  });
  it("returns empty string when all tickers are null/empty", () => {
    expect(buildQuotesQuery([null, "", "   "])).toBe("");
  });
  it("dedupes tickers", () => {
    expect(buildQuotesQuery(["AAPL", "AAPL", "MSFT"])).toBe("?tickers=AAPL%2CMSFT");
  });
  it("drops null/empty tickers", () => {
    expect(buildQuotesQuery(["AAPL", null, "", "MSFT"])).toBe("?tickers=AAPL%2CMSFT");
  });
  it("uppercases and trims tickers", () => {
    expect(buildQuotesQuery([" aapl ", "msft"])).toBe("?tickers=AAPL%2CMSFT");
  });
  it("dedupes case-insensitively after uppercasing", () => {
    expect(buildQuotesQuery(["aapl", "AAPL"])).toBe("?tickers=AAPL");
  });
});

describe("buildRecurringPreviewQuery", () => {
  it("emits all four params in fixed order", () => {
    const qs = buildRecurringPreviewQuery({ matchType: "exact", pattern: "Netflix", amountMin: 10, amountMax: 20 });
    expect(qs).toBe("?matchType=exact&pattern=Netflix&amountMin=10&amountMax=20");
  });
  it("url-encodes spaces and ampersands in pattern", () => {
    const qs = buildRecurringPreviewQuery({ matchType: "contains", pattern: "AT&T Wireless", amountMin: 0, amountMax: 100 });
    expect(qs).toContain("pattern=AT%26T%20Wireless");
  });
});
