// mobile/src/api/query.test.ts
import { describe, it, expect } from "vitest";
import { buildTransactionsQuery } from "./query";

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
