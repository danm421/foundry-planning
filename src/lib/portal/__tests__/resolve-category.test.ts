import { describe, it, expect } from "vitest";
import { resolveTransactionCategory } from "@/lib/portal/resolve-category";

const slugToId = new Map<string, string>([
  ["food-restaurants", "id-restaurants"],
  ["food-groceries", "id-groceries"],
]);

describe("resolveTransactionCategory", () => {
  it("a matching rule wins over PFC and reports categorizedBy=rule", () => {
    const out = resolveTransactionCategory({
      rules: [{ matchType: "contains", pattern: "whole foods", categoryId: "id-groceries", priority: 1 }],
      pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: null,
      merchantName: "Whole Foods", name: "wholefds", slugToId,
    });
    expect(out).toEqual({ categoryId: "id-groceries", categorizedBy: "rule" });
  });
  it("falls back to PFC mapping (categorizedBy=plaid) when no rule matches", () => {
    const out = resolveTransactionCategory({
      rules: [], pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: null,
      merchantName: "Some Diner", name: "diner", slugToId,
    });
    expect(out).toEqual({ categoryId: "id-restaurants", categorizedBy: "plaid" });
  });
  it("uncategorized (null) + plaid when neither rule nor PFC resolves", () => {
    const out = resolveTransactionCategory({
      rules: [], pfcPrimary: "WHO_KNOWS", pfcDetailed: null,
      merchantName: null, name: "mystery", slugToId,
    });
    expect(out).toEqual({ categoryId: null, categorizedBy: "plaid" });
  });
  it("PFC slug not present in the client's slugToId map → uncategorized", () => {
    const out = resolveTransactionCategory({
      rules: [], pfcPrimary: "TRAVEL", pfcDetailed: null,
      merchantName: "Delta", name: "delta air", slugToId,
    });
    expect(out).toEqual({ categoryId: null, categorizedBy: "plaid" });
  });
});
