import { describe, it, expect } from "vitest";
import { matchesRule, resolveRuleCategory } from "@/lib/portal/rule-matching";

const txn = (merchantName: string | null, name: string) => ({ merchantName, name });

describe("matchesRule", () => {
  it("exact match is case-insensitive against merchantName", () => {
    expect(matchesRule({ matchType: "exact", pattern: "Amazon", categoryId: "x", priority: 1 }, txn("AMAZON", "amzn mktp"))).toBe(true);
  });
  it("exact match requires the whole field to equal the pattern", () => {
    expect(matchesRule({ matchType: "exact", pattern: "Amazon", categoryId: "x", priority: 1 }, txn("Amazon Prime", "x"))).toBe(false);
  });
  it("contains match falls through merchantName then name", () => {
    expect(matchesRule({ matchType: "contains", pattern: "uber", categoryId: "x", priority: 1 }, txn(null, "UBER EATS 123"))).toBe(true);
  });
  it("no match returns false", () => {
    expect(matchesRule({ matchType: "contains", pattern: "netflix", categoryId: "x", priority: 1 }, txn("Hulu", "hulu.com"))).toBe(false);
  });
});

describe("resolveRuleCategory", () => {
  it("lowest priority wins among multiple matches", () => {
    const rules = [
      { matchType: "contains" as const, pattern: "coffee", categoryId: "lo", priority: 100 },
      { matchType: "contains" as const, pattern: "coffee", categoryId: "hi", priority: 5 },
    ];
    expect(resolveRuleCategory(rules, txn("Blue Bottle Coffee", "coffee"))?.categoryId).toBe("hi");
  });
  it("returns null when nothing matches", () => {
    expect(resolveRuleCategory([], txn("X", "y"))).toBeNull();
  });
});
