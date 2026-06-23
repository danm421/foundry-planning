// src/lib/portal/__tests__/budget-summary.test.ts
import { describe, it, expect } from "vitest";
import {
  computeBudgetSummary,
  type BudgetCategory,
} from "@/lib/portal/budget-summary";

// Minimal taxonomy: an income group + two expense groups, each with leaves.
const cats: BudgetCategory[] = [
  { id: "g-income", parentId: null, name: "Income", slug: "income", color: "var(--data-green)", kind: "group", sortOrder: 10 },
  { id: "l-paycheck", parentId: "g-income", name: "Paycheck", slug: "income-paycheck", color: "var(--data-green)", kind: "category", sortOrder: 1 },
  { id: "g-food", parentId: null, name: "Food & Drink", slug: "food", color: "var(--data-orange)", kind: "group", sortOrder: 30 },
  { id: "l-groceries", parentId: "g-food", name: "Groceries", slug: "food-groceries", color: "var(--data-orange)", kind: "category", sortOrder: 1 },
  { id: "l-restaurants", parentId: "g-food", name: "Restaurants", slug: "food-restaurants", color: "var(--data-orange)", kind: "category", sortOrder: 2 },
  { id: "g-shopping", parentId: null, name: "Shopping", slug: "shopping", color: "var(--data-purple)", kind: "group", sortOrder: 40 },
  { id: "l-general", parentId: "g-shopping", name: "General", slug: "shopping-general", color: "var(--data-purple)", kind: "category", sortOrder: 1 },
];

it("excludes the income group from groups and totals; reports income separately", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [],
    transactions: [
      { categoryId: "l-paycheck", amount: -5000 }, // money IN
      { categoryId: "l-groceries", amount: 200 },
    ],
  });
  expect(s.groups.map((g) => g.id)).toEqual(["g-food", "g-shopping"]); // no g-income
  expect(s.incomeThisMonth).toBe(5000);
  expect(s.totalSpent).toBe(200);
});

it("sums leaf actuals into the group actual; refunds net down (signed)", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [],
    transactions: [
      { categoryId: "l-groceries", amount: 200 },
      { categoryId: "l-groceries", amount: -50 }, // refund
      { categoryId: "l-restaurants", amount: 80 },
    ],
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  expect(food.actual).toBe(230);
  expect(food.leaves.find((l) => l.id === "l-groceries")!.actual).toBe(150);
});

it("group budget = sum of leaf budgets when no explicit group budget", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [
      { categoryId: "l-groceries", monthlyAmount: 400 },
      { categoryId: "l-restaurants", monthlyAmount: 150 },
    ],
    transactions: [{ categoryId: "l-groceries", amount: 100 }],
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  expect(food.budgetIsExplicit).toBe(false);
  expect(food.budget).toBe(550);
  expect(food.remaining).toBe(450); // 550 - 100
});

it("explicit group budget overrides the leaf-budget sum (no double count)", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [
      { categoryId: "g-food", monthlyAmount: 600 },
      { categoryId: "l-groceries", monthlyAmount: 400 }, // still shown on the leaf
    ],
    transactions: [{ categoryId: "l-groceries", amount: 100 }],
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  expect(food.budgetIsExplicit).toBe(true);
  expect(food.budget).toBe(600);
  expect(food.leaves.find((l) => l.id === "l-groceries")!.budget).toBe(400);
  expect(s.totalBudget).toBe(600); // not 600+400
});

it("unbudgeted group has null budget and null remaining", () => {
  const s = computeBudgetSummary({ categories: cats, budgets: [], transactions: [] });
  const shopping = s.groups.find((g) => g.id === "g-shopping")!;
  expect(shopping.budget).toBeNull();
  expect(shopping.remaining).toBeNull();
});

it("totals: remaining can go negative (overspend)", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [{ categoryId: "g-food", monthlyAmount: 100 }],
    transactions: [{ categoryId: "l-groceries", amount: 250 }],
  });
  expect(s.totalBudget).toBe(100);
  expect(s.totalSpent).toBe(250);
  expect(s.totalRemaining).toBe(-150);
});

it("ignores transactions with a null or unknown categoryId", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [],
    transactions: [
      { categoryId: null, amount: 999 },
      { categoryId: "does-not-exist", amount: 999 },
      { categoryId: "l-groceries", amount: 10 },
    ],
  });
  expect(s.totalSpent).toBe(10);
});
