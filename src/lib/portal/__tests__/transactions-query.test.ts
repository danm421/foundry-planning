import { describe, it, expect, vi } from "vitest";
import type { PortalTransactionDTO } from "@/lib/portal/transactions-query";
vi.mock("@/db/schema", () => ({ plaidTransactions: {
  clientId: "client_id", date: "date", categoryId: "category_id",
  merchantName: "merchant_name", name: "name", excluded: "excluded",
  reviewedAt: "reviewed_at",
} }));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ op: "and", a }),
  eq: (c: unknown, v: unknown) => ({ op: "eq", c, v }),
  gte: (c: unknown, v: unknown) => ({ op: "gte", c, v }),
  lte: (c: unknown, v: unknown) => ({ op: "lte", c, v }),
  or: (...a: unknown[]) => ({ op: "or", a }),
  ilike: (c: unknown, v: unknown) => ({ op: "ilike", c, v }),
  desc: (c: unknown) => ({ op: "desc", c }),
  isNull: (c: unknown) => ({ op: "isNull", c }),
  isNotNull: (c: unknown) => ({ op: "isNotNull", c }),
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
    const orCond = conds.find((c) => (c as { op: string }).op === "or");
    expect(orCond).toBeTruthy();
  });
});

const base = { limit: 50, offset: 0 };

describe("buildTransactionConditions — reviewed filter", () => {
  it("adds no reviewed condition when undefined", () => {
    const before = buildTransactionConditions("c1", { ...base }).length;
    const after = buildTransactionConditions("c1", { ...base, reviewed: undefined }).length;
    expect(after).toBe(before);
  });
  it("adds one condition when reviewed=false (unreviewed only)", () => {
    const before = buildTransactionConditions("c1", { ...base }).length;
    const after = buildTransactionConditions("c1", { ...base, reviewed: false }).length;
    expect(after).toBe(before + 1);
  });
  it("adds one condition when reviewed=true", () => {
    const before = buildTransactionConditions("c1", { ...base }).length;
    const after = buildTransactionConditions("c1", { ...base, reviewed: true }).length;
    expect(after).toBe(before + 1);
  });
});

it("DTO includes a type field", () => {
  const dto: PortalTransactionDTO = {
    id: "t1", date: "2026-06-01", name: "n", merchantName: null, amount: "1.00",
    pending: false, excluded: false, categoryId: null, categoryName: null,
    categoryColor: null, categorizedBy: "plaid", accountId: null,
    accountName: null, accountMask: null, type: "expense", reviewed: false,
  };
  expect(dto.type).toBe("expense");
});
