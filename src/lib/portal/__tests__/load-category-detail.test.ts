import { describe, it, expect, vi, beforeEach } from "vitest";

// Each db.select() takes the next queued result. Only the transaction-row query
// joins categories, so a leftJoin call marks that query as having run.
const results: unknown[][] = [];
let rowQueries = 0;
vi.mock("@/db", () => ({
  db: {
    select: () => {
      const rows = results.shift() ?? [];
      const q: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(res, rej),
      };
      for (const k of ["from", "where", "groupBy", "orderBy", "limit"]) q[k] = () => q;
      q.leftJoin = () => {
        rowQueries++;
        return q;
      };
      return q;
    },
  },
}));

import { loadCategoryDetail } from "@/lib/portal/load-category-detail";

const NOW = new Date("2026-09-15T12:00:00Z");
const TXN = {
  id: "t1",
  date: "2026-09-01",
  name: "Pharmacy",
  merchantName: "Pharmacy",
  amount: "12.50",
  categoryId: "cat1",
  categoryName: "Health",
  categoryColor: "#000",
};

beforeEach(() => {
  rowQueries = 0;
  results.length = 0;
  results.push(
    [{ id: "cat1", parentId: "g1", name: "Health", slug: "health", color: "#000", kind: "category" }],
    [], // budgets
    [{ month: "2026-09", total: "12.50" }], // monthly totals
    [TXN],
  );
});

describe("loadCategoryDetail", () => {
  it("returns the monthly totals without querying transactions when they are withheld", async () => {
    const detail = await loadCategoryDetail("c1", "cat1", NOW, { includeTransactions: false });
    expect(detail?.transactions).toEqual([]);
    expect(detail?.spentThisMonth).toBe(12.5);
    expect(rowQueries).toBe(0);
  });

  it("includes the transactions by default", async () => {
    const detail = await loadCategoryDetail("c1", "cat1", NOW);
    expect(detail?.transactions.map((t) => t.id)).toEqual(["t1"]);
    expect(rowQueries).toBe(1);
  });
});
