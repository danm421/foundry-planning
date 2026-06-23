import { describe, it, expect, vi, beforeEach } from "vitest";

const rulesSelect = vi.fn();
const catsSelect = vi.fn();

vi.mock("@/db/schema", () => ({
  transactionRules: { _name: "transaction_rules" },
  transactionCategories: { _name: "transaction_categories" },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, isNotNull: (x: unknown) => x }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => (tbl._name === "transaction_rules" ? rulesSelect() : catsSelect()),
      }),
    }),
  },
}));

import { loadCategorizationContext } from "@/lib/portal/load-categorization-context";

beforeEach(() => { rulesSelect.mockReset(); catsSelect.mockReset(); });

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
    const ctx = await loadCategorizationContext("c1");
    expect(ctx.rules).toHaveLength(1);
    expect(ctx.slugToId.get("transport-transit")).toBe("cat-1");
    expect(ctx.slugToId.get("food-groceries")).toBe("cat-2");
  });
});
