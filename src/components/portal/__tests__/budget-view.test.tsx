// src/components/portal/__tests__/budget-view.test.tsx
// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

// Stub the donut so jsdom never draws a canvas.
vi.mock("@/components/portal/budget-donut", () => ({
  BudgetDonut: () => <div data-testid="donut" />,
}));
// Stub the detail panel; echo the props so we can assert selection + editEnabled.
vi.mock("@/components/portal/budget-category-detail", () => ({
  BudgetCategoryDetail: ({
    categoryId,
    editEnabled,
  }: {
    categoryId: string;
    editEnabled: boolean;
  }) => (
    <div data-testid="detail">
      id:{categoryId} edit:{String(editEnabled)}
    </div>
  ),
}));

import BudgetView from "@/components/portal/budget-view";

const summary = {
  month: "2026-06",
  totalBudget: 600,
  totalSpent: 230,
  totalRemaining: 370,
  incomeThisMonth: 5000,
  groups: [
    {
      id: "g-food",
      name: "Food & Drink",
      slug: "food",
      color: "var(--data-orange)",
      budget: 600,
      budgetIsExplicit: true,
      unallocated: 200,
      actual: 230,
      remaining: 370,
      leaves: [
        { id: "l-groceries", name: "Groceries", slug: "food-groceries", color: "var(--data-orange)", budget: 400, actual: 150 },
        { id: "l-rest", name: "Restaurants", slug: "food-restaurants", color: "var(--data-orange)", budget: null, actual: 80 },
      ],
    },
    {
      id: "g-shop",
      name: "Shopping",
      slug: "shopping",
      color: "var(--data-purple)",
      budget: null,
      budgetIsExplicit: false,
      unallocated: 0,
      actual: 0,
      remaining: null,
      leaves: [
        { id: "l-cloth", name: "Clothing", slug: "shopping-clothing", color: "var(--data-purple)", budget: null, actual: 0 },
      ],
    },
  ],
};

beforeEach(() => {
  refreshMock.mockClear();
  const root = document.createElement("div");
  root.id = "portal-detail";
  document.body.appendChild(root);
});
afterEach(() => {
  document.getElementById("portal-detail")?.remove();
});

it("renders the month, summary, groups and the spend group's leaves", () => {
  render(<BudgetView summary={summary} editEnabled={false} />);
  expect(screen.getByText(/June 2026/)).toBeTruthy();
  expect(screen.getByTestId("donut")).toBeTruthy();
  expect(screen.getByText("Food & Drink")).toBeTruthy();
  // g-food has spend → expanded by default → its leaves are visible.
  expect(screen.getByText("Groceries")).toBeTruthy();
  expect(screen.getByText("Restaurants")).toBeTruthy();
});

it("portals a detail for the default selection (first group with spend)", () => {
  render(<BudgetView summary={summary} editEnabled={false} />);
  expect(screen.getByTestId("detail").textContent).toContain("id:g-food");
  expect(screen.getByTestId("detail").textContent).toContain("edit:false");
});

it("selecting a leaf swaps the detail to that category", () => {
  render(<BudgetView summary={summary} editEnabled />);
  fireEvent.click(screen.getByText("Groceries"));
  expect(screen.getByTestId("detail").textContent).toContain("id:l-groceries");
  expect(screen.getByTestId("detail").textContent).toContain("edit:true");
});

it("expands a collapsed (no-spend) group to reveal its leaves", () => {
  render(<BudgetView summary={summary} editEnabled={false} />);
  // g-shop has no spend → collapsed → Clothing hidden until expanded.
  expect(screen.queryByText("Clothing")).toBeNull();
  fireEvent.click(screen.getByText("Shopping"));
  expect(screen.getByText("Clothing")).toBeTruthy();
});
