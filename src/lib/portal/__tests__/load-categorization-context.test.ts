import { describe, it, expect, vi, beforeEach } from "vitest";

const rulesSelect = vi.fn();
const catsSelect = vi.fn();
const recurringsSelect = vi.fn();

vi.mock("@/db/schema", () => ({
  transactionRules: { _name: "transaction_rules" },
  transactionCategories: { _name: "transaction_categories" },
  recurringTransactions: { _name: "recurring_transactions" },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, isNotNull: (x: unknown) => x }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => {
          if (tbl._name === "transaction_rules") return rulesSelect();
          if (tbl._name === "recurring_transactions") return recurringsSelect();
          return catsSelect();
        },
      }),
    }),
  },
}));

import { loadCategorizationContext } from "@/lib/portal/load-categorization-context";

beforeEach(() => { rulesSelect.mockReset(); catsSelect.mockReset(); recurringsSelect.mockReset(); });

describe("loadCategorizationContext", () => {
  it("returns the client's rules and a slug->id map of its categories", async () => {
    rulesSelect.mockResolvedValue([
      { matchType: "contains", pattern: "uber", categoryId: "cat-1", priority: 10 },
    ]);
    catsSelect.mockResolvedValue([
      { id: "cat-1", slug: "transport-transit" },
      { id: "cat-2", slug: "food-groceries" },
      { id: "cat-grp", slug: "food" },
    ]);
    recurringsSelect.mockResolvedValue([]);
    const ctx = await loadCategorizationContext("c1");
    expect(ctx.rules).toHaveLength(1);
    expect(ctx.slugToId.get("transport-transit")).toBe("cat-1");
    expect(ctx.slugToId.get("food-groceries")).toBe("cat-2");
    expect(ctx.recurrings).toHaveLength(0);
  });

  it("maps recurringRows with Number() conversion on decimal fields", async () => {
    rulesSelect.mockResolvedValue([]);
    catsSelect.mockResolvedValue([]);
    recurringsSelect.mockResolvedValue([
      {
        id: "r1", matchType: "contains", pattern: "netflix",
        amountMin: "12.99", amountMax: "15.00",
        cadence: "monthly", dueDay: 5, dueMonth: null,
        categoryId: "cat-streaming", createdAt: new Date("2026-01-01"),
      },
    ]);
    const ctx = await loadCategorizationContext("c1");
    expect(ctx.recurrings).toHaveLength(1);
    expect(ctx.recurrings[0].amountMin).toBe(12.99);
    expect(ctx.recurrings[0].amountMax).toBe(15);
    expect(ctx.recurrings[0].id).toBe("r1");
  });
});
