import { describe, it, expect } from "vitest";
import { resolveTransactionCategory } from "@/lib/portal/resolve-category";
import type { RecurringLike } from "@/lib/portal/recurring-matching";

const slugToId = new Map<string, string>([
  ["food-restaurants", "id-restaurants"],
  ["food-groceries", "id-groceries"],
]);

describe("resolveTransactionCategory", () => {
  it("a matching rule wins over PFC and reports categorizedBy=rule", () => {
    const out = resolveTransactionCategory({
      rules: [{ matchType: "contains", pattern: "whole foods", categoryId: "id-groceries", priority: 1 }],
      recurrings: [],
      pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: null,
      merchantName: "Whole Foods", name: "wholefds",
      amount: 50, date: "2026-06-10",
      slugToId,
    });
    expect(out).toEqual({ categoryId: "id-groceries", categorizedBy: "rule", recurringTransactionId: null });
  });
  it("falls back to PFC mapping (categorizedBy=plaid) when no rule matches", () => {
    const out = resolveTransactionCategory({
      rules: [],
      recurrings: [],
      pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: null,
      merchantName: "Some Diner", name: "diner",
      amount: 20, date: "2026-06-10",
      slugToId,
    });
    expect(out).toEqual({ categoryId: "id-restaurants", categorizedBy: "plaid", recurringTransactionId: null });
  });
  it("uncategorized (null) + plaid when neither rule nor PFC resolves", () => {
    const out = resolveTransactionCategory({
      rules: [],
      recurrings: [],
      pfcPrimary: "WHO_KNOWS", pfcDetailed: null,
      merchantName: null, name: "mystery",
      amount: 10, date: "2026-06-10",
      slugToId,
    });
    expect(out).toEqual({ categoryId: null, categorizedBy: "plaid", recurringTransactionId: null });
  });
  it("PFC slug not present in the client's slugToId map → uncategorized", () => {
    const out = resolveTransactionCategory({
      rules: [],
      recurrings: [],
      pfcPrimary: "TRAVEL", pfcDetailed: null,
      merchantName: "Delta", name: "delta air",
      amount: 500, date: "2026-06-10",
      slugToId,
    });
    expect(out).toEqual({ categoryId: null, categorizedBy: "plaid", recurringTransactionId: null });
  });
});

const recurring: RecurringLike = {
  id: "r1", matchType: "contains", pattern: "costco",
  amountMin: 100, amountMax: 400, cadence: "monthly",
  dueDay: 15, dueMonth: null, categoryId: "l-groceries",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

it("recurring claim wins over rule and PFC, returns recurringTransactionId", () => {
  const r = resolveTransactionCategory({
    rules: [{ matchType: "contains", pattern: "costco", categoryId: "l-other", priority: 1 }],
    recurrings: [recurring],
    pfcPrimary: "FOOD_AND_DRINK", pfcDetailed: null,
    merchantName: "COSTCO", name: "x",
    amount: 250, date: "2026-06-10",
    slugToId: new Map([["food-groceries", "pfc-groceries"]]),
  });
  expect(r).toEqual({ categoryId: "l-groceries", categorizedBy: "recurring", recurringTransactionId: "r1" });
});

it("falls back to rule when no recurring matches", () => {
  const r = resolveTransactionCategory({
    rules: [{ matchType: "contains", pattern: "target", categoryId: "l-shopping", priority: 1 }],
    recurrings: [recurring],
    pfcPrimary: null, pfcDetailed: null,
    merchantName: "TARGET", name: "x",
    amount: 80, date: "2026-06-10",
    slugToId: new Map(),
  });
  expect(r).toEqual({ categoryId: "l-shopping", categorizedBy: "rule", recurringTransactionId: null });
});
