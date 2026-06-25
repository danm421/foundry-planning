// src/components/portal/__tests__/budget-view-portal-target.test.tsx
// @vitest-environment jsdom
//
// Regression: the budget detail rail must mount even when #portal-detail is
// rendered as a SIBLING in the same React tree (the real portal layout), not
// pre-mounted into document.body. Resolving the portal target in a useState
// initializer reads the DOM during the render phase — before the sibling aside
// is committed — so getElementById returns null and createPortal never fires.
import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/portal/budget-donut", () => ({
  BudgetDonut: () => <div data-testid="donut" />,
}));
vi.mock("@/components/portal/budget-category-detail", () => ({
  BudgetCategoryDetail: ({ categoryId }: { categoryId: string }) => (
    <div data-testid="detail">id:{categoryId}</div>
  ),
}));

import BudgetView from "@/components/portal/budget-view";

const summary = {
  month: "2026-06",
  totalBudget: 600,
  totalSpent: 230,
  totalRemaining: 370,
  incomeThisMonth: 0,
  groups: [
    {
      id: "g-food",
      name: "Food & Drink",
      slug: "food",
      color: "var(--data-orange)",
      budget: 600,
      budgetIsExplicit: true,
      actual: 230,
      remaining: 370,
      leaves: [
        { id: "l-rest", name: "Restaurants", slug: "food-restaurants", color: "var(--data-orange)", budget: null, actual: 230 },
      ],
    },
  ],
};

// Mirrors the real layout: the page renders <main>{section}</main> and the
// #portal-detail aside as siblings in a SINGLE React render.
function LayoutLike(): ReactElement {
  return (
    <div>
      <main>
        <BudgetView summary={summary} editEnabled={false} />
      </main>
      <aside id="portal-detail" />
    </div>
  );
}

it("portals the default detail when #portal-detail is a same-render sibling", () => {
  render(<LayoutLike />);
  expect(screen.getByTestId("detail").textContent).toContain("id:g-food");
});
