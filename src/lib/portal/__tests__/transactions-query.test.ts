import { describe, it, expect, vi } from "vitest";
vi.mock("@/db/schema", () => ({ plaidTransactions: {
  clientId: "client_id", date: "date", categoryId: "category_id",
  merchantName: "merchant_name", name: "name", excluded: "excluded",
} }));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ op: "and", a }),
  eq: (c: unknown, v: unknown) => ({ op: "eq", c, v }),
  gte: (c: unknown, v: unknown) => ({ op: "gte", c, v }),
  lte: (c: unknown, v: unknown) => ({ op: "lte", c, v }),
  or: (...a: unknown[]) => ({ op: "or", a }),
  ilike: (c: unknown, v: unknown) => ({ op: "ilike", c, v }),
  desc: (c: unknown) => ({ op: "desc", c }),
}));
import { buildTransactionConditions } from "@/lib/portal/transactions-query";

describe("buildTransactionConditions", () => {
  it("always scopes by clientId and excludes excluded by default", () => {
    const conds = buildTransactionConditions("c1", { limit: 50, offset: 0 });
    expect(conds).toContainEqual({ op: "eq", c: "client_id", v: "c1" });
    expect(conds).toContainEqual({ op: "eq", c: "excluded", v: false });
  });
  it("includeExcluded drops the excluded predicate", () => {
    const conds = buildTransactionConditions("c1", { limit: 50, offset: 0, includeExcluded: true });
    expect(conds).not.toContainEqual({ op: "eq", c: "excluded", v: false });
  });
  it("adds gte/lte for from/to and an eq for categoryId", () => {
    const conds = buildTransactionConditions("c1", { from: "2026-01-01", to: "2026-02-01", categoryId: "cat", limit: 50, offset: 0 });
    expect(conds).toContainEqual({ op: "gte", c: "date", v: "2026-01-01" });
    expect(conds).toContainEqual({ op: "lte", c: "date", v: "2026-02-01" });
    expect(conds).toContainEqual({ op: "eq", c: "category_id", v: "cat" });
  });
  it("adds an OR ilike across merchant_name and name for q", () => {
    const conds = buildTransactionConditions("c1", { q: "coffee", limit: 50, offset: 0 });
    const orCond = conds.find((c: any) => c.op === "or");
    expect(orCond).toBeTruthy();
  });
});
