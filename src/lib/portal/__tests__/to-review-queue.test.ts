/* eslint-disable @typescript-eslint/no-explicit-any */
// The page the tile shows and the count beneath it have to select from the
// same set — a count that outran its page would leave the client clicking
// "Mark these reviewed" on a queue that never empties.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/schema", () => ({
  accounts: { _name: "accounts", id: "accounts.id", name: "accounts.name" },
  plaidTransactions: {
    _name: "plaidTransactions",
    id: "txn.id",
    date: "txn.date",
    name: "txn.name",
    merchantName: "txn.merchantName",
    amount: "txn.amount",
    accountId: "txn.accountId",
    categoryId: "txn.categoryId",
    clientId: "txn.clientId",
    excluded: "txn.excluded",
    type: "txn.type",
    reviewedAt: "txn.reviewedAt",
  },
  transactionCategories: { _name: "transactionCategories", id: "cat.id", name: "cat.name", color: "cat.color" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ["and", ...a],
  desc: (a: unknown) => ["desc", a],
  eq: (...a: unknown[]) => ["eq", ...a],
  isNull: (a: unknown) => ["isNull", a],
  ne: (...a: unknown[]) => ["ne", ...a],
  sql: (...a: unknown[]) => ["sql", ...a],
}));

const calls: Array<{ where?: unknown; limit?: unknown; orderBy?: unknown[] }> = [];
let rows: unknown[] = [];

function chain(): any {
  const c: any = {};
  const rec: { where?: unknown; limit?: unknown; orderBy?: unknown[] } = {};
  calls.push(rec);
  c.from = () => c;
  c.leftJoin = () => c;
  c.where = (w: unknown) => { rec.where = w; return c; };
  c.orderBy = (...o: unknown[]) => { rec.orderBy = o; return c; };
  c.limit = (n: unknown) => { rec.limit = n; return c; };
  c.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  return c;
}
vi.mock("@/db", () => ({ db: { select: () => chain() } }));

import { toReviewPage, toReviewCount, toReviewWhere, REVIEW_PAGE_SIZE } from "@/lib/portal/to-review-queue";

beforeEach(() => {
  calls.length = 0;
  rows = [];
});

describe("to-review queue", () => {
  it("selects the page and the count from the identical filter", async () => {
    await toReviewPage("c1");
    await toReviewCount("c1");
    expect(calls).toHaveLength(2);
    expect(calls[0].where).toEqual(calls[1].where);
    expect(calls[0].where).toEqual(toReviewWhere("c1"));
    // Non-excluded, non-transfer, unreviewed — mirrored in the route's UPDATE.
    const w = JSON.stringify(calls[0].where);
    expect(w).toContain("txn.excluded");
    expect(w).toContain("txn.type");
    expect(w).toContain("txn.reviewedAt");
    expect(w).toContain("c1");
  });

  it("returns one page newest-first with numeric amounts", async () => {
    rows = [
      { id: "t1", date: "2026-06-20", name: "AMZN", merchantName: "Amazon", amount: "42.10", accountName: "Card", categoryId: null, categoryName: null, categoryColor: null },
    ];
    const page = await toReviewPage("c1");
    expect(page[0].amount).toBe(42.1);
    expect(calls[0].limit).toBe(REVIEW_PAGE_SIZE);
    expect(JSON.stringify(calls[0].orderBy)).toBe(JSON.stringify([["desc", "txn.date"], ["desc", "txn.id"]]));
  });

  it("reads zero when the client has nothing to review", async () => {
    rows = [];
    expect(await toReviewCount("c1")).toBe(0);
    rows = [{ count: 7 }];
    expect(await toReviewCount("c1")).toBe(7);
  });
});
