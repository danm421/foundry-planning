import { describe, it, expect, vi, beforeEach } from "vitest";
const updateSet = vi.fn();
const countMock = vi.fn();
vi.mock("@/db/schema", () => ({ plaidTransactions: {
  clientId: "client_id", merchantName: "merchant_name", name: "name", categorizedBy: "categorized_by",
} }));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }), eq: (...a: unknown[]) => ({ eq: a }),
  or: (...a: unknown[]) => ({ or: a }), ne: (...a: unknown[]) => ({ ne: a }),
  ilike: (...a: unknown[]) => ({ ilike: a }), sql: (s: unknown) => ({ sql: s }),
}));
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (v: unknown) => ({ where: () => { updateSet(v); return { returning: () => Promise.resolve([{ id: "a" }, { id: "b" }]) }; } }) }),
    select: () => ({ from: () => ({ where: () => countMock() }) }),
  },
}));
import { applyRuleRetroactively, countRuleMatches } from "@/lib/portal/recategorize";

beforeEach(() => { updateSet.mockReset(); countMock.mockReset(); });

describe("applyRuleRetroactively", () => {
  it("sets categorizedBy=rule + categoryId and returns the updated count", async () => {
    const n = await applyRuleRetroactively("c1", { id: "r1", matchType: "contains", pattern: "uber", categoryId: "cat-1" });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "cat-1", categorizedBy: "rule" }));
    expect(n).toBe(2);
  });
});
describe("countRuleMatches", () => {
  it("returns the match count", async () => {
    countMock.mockResolvedValue([{ count: 7 }]);
    expect(await countRuleMatches("c1", "exact", "Amazon")).toBe(7);
  });
});
