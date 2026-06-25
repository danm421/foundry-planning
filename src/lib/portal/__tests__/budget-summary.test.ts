// src/lib/portal/__tests__/budget-summary.test.ts
import { it, expect } from "vitest";
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
      { categoryId: "l-paycheck", amount: -5000, type: "income" },
      { categoryId: "l-groceries", amount: 200, type: "expense" },
    ],
  });
  expect(s.groups.map((g) => g.id)).toEqual(["g-food", "g-shopping"]); // no g-income
  expect(s.incomeThisMonth).toBe(5000);
  expect(s.totalSpent).toBe(200);
});

it("excludes internal transfers from both spend and income", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [],
    transactions: [
      { categoryId: "l-groceries", amount: 200, type: "expense" },
      { categoryId: null, amount: 2000, type: "transfer" },   // transfer out
      { categoryId: null, amount: -2000, type: "transfer" },  // transfer in
      { categoryId: "l-paycheck", amount: -5000, type: "income" },
    ],
  });
  expect(s.totalSpent).toBe(200);        // transfers don't add to spend
  expect(s.incomeThisMonth).toBe(5000);  // transfers don't add to income
});

it("sums leaf actuals into the group actual; refunds net down (signed)", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [],
    transactions: [
      { categoryId: "l-groceries", amount: 200, type: "expense" },
      { categoryId: "l-groceries", amount: -50, type: "expense" }, // refund
      { categoryId: "l-restaurants", amount: 80, type: "expense" },
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
    transactions: [{ categoryId: "l-groceries", amount: 100, type: "expense" }],
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  expect(food.budgetIsExplicit).toBe(false);
  expect(food.budget).toBe(550);
  expect(food.remaining).toBe(450); // 550 - 100
});

it("explicit group budget ABOVE the leaf sum raises the total; surfaces unallocated excess", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [
      { categoryId: "g-food", monthlyAmount: 600 },
      { categoryId: "l-groceries", monthlyAmount: 400 }, // l-restaurants unbudgeted → leafSum 400
    ],
    transactions: [{ categoryId: "l-groceries", amount: 100, type: "expense" }],
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  expect(food.budgetIsExplicit).toBe(true);
  expect(food.budget).toBe(600); // max(600, 400)
  expect(food.unallocated).toBe(200); // 600 - 400 free within the group
  expect(food.leaves.find((l) => l.id === "l-groceries")!.budget).toBe(400);
  expect(s.totalBudget).toBe(600); // not 600 + 400
});

it("the category sum is the FLOOR: an explicit group budget below it is ignored", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [
      { categoryId: "g-food", monthlyAmount: 300 }, // below the leaf sum
      { categoryId: "l-groceries", monthlyAmount: 400 },
      { categoryId: "l-restaurants", monthlyAmount: 150 }, // leafSum 550
    ],
    transactions: [],
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  expect(food.budget).toBe(550); // max(300, 550) → the floor wins
  expect(food.unallocated).toBe(0); // explicit < sum → nothing free
});

it("a group budget with no leaf budgets is fully unallocated", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [{ categoryId: "g-shopping", monthlyAmount: 500 }], // l-general unbudgeted
    transactions: [],
  });
  const shopping = s.groups.find((g) => g.id === "g-shopping")!;
  expect(shopping.budget).toBe(500);
  expect(shopping.unallocated).toBe(500);
});

it("unallocated is 0 when the group budget is just the leaf-sum rollup", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [
      { categoryId: "l-groceries", monthlyAmount: 400 },
      { categoryId: "l-restaurants", monthlyAmount: 150 },
    ],
    transactions: [],
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  expect(food.budget).toBe(550);
  expect(food.budgetIsExplicit).toBe(false);
  expect(food.unallocated).toBe(0);
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
    transactions: [{ categoryId: "l-groceries", amount: 250, type: "expense" }],
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
      { categoryId: null, amount: 999, type: "expense" },
      { categoryId: "does-not-exist", amount: 999, type: "expense" },
      { categoryId: "l-groceries", amount: 10, type: "expense" },
    ],
  });
  expect(s.totalSpent).toBe(10);
});

it("adds recurring reservations into the leaf actual (blended Spent)", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [{ categoryId: "l-groceries", monthlyAmount: 800 }],
    transactions: [{ categoryId: "l-groceries", amount: 300, type: "expense" }], // posted
    recurrings: [{ categoryId: "l-groceries", reservation: 250 }], // unposted recurring
  });
  const food = s.groups.find((g) => g.id === "g-food")!;
  const groceries = food.leaves.find((l) => l.id === "l-groceries")!;
  expect(groceries.actual).toBe(550); // 300 posted + 250 reserved
  expect(food.remaining).toBe(250); // 800 - 550
});

it("a zero reservation (fully posted recurring) does not change Spent", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [{ categoryId: "l-groceries", monthlyAmount: 800 }],
    transactions: [{ categoryId: "l-groceries", amount: 250, type: "expense" }],
    recurrings: [{ categoryId: "l-groceries", reservation: 0 }],
  });
  const groceries = s.groups
    .find((g) => g.id === "g-food")!
    .leaves.find((l) => l.id === "l-groceries")!;
  expect(groceries.actual).toBe(250);
});

it("omitting recurrings is backward-compatible", () => {
  const s = computeBudgetSummary({
    categories: cats,
    budgets: [{ categoryId: "l-groceries", monthlyAmount: 800 }],
    transactions: [{ categoryId: "l-groceries", amount: 300, type: "expense" }],
  });
  const groceries = s.groups
    .find((g) => g.id === "g-food")!
    .leaves.find((l) => l.id === "l-groceries")!;
  expect(groceries.actual).toBe(300);
});
