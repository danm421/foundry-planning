// src/components/portal/__tests__/budget-view.test.tsx
// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));
// Stub the donut so jsdom never draws a canvas.
vi.mock("@/components/portal/budget-donut", () => ({
  BudgetDonut: () => <div data-testid="donut" />,
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
      id: "g-food", name: "Food & Drink", color: "var(--data-orange)",
      budget: 600, budgetIsExplicit: true, actual: 230, remaining: 370,
      leaves: [
        { id: "l-groceries", name: "Groceries", color: "var(--data-orange)", budget: 400, actual: 150 },
        { id: "l-rest", name: "Restaurants", color: "var(--data-orange)", budget: null, actual: 80 },
      ],
    },
  ],
};

beforeEach(() => { refreshMock.mockClear(); portalFetchMock.mockReset(); });

it("renders the month, key metrics, group and leaves", () => {
  render(<BudgetView summary={summary} editEnabled={false} />);
  expect(screen.getByText(/June 2026/)).toBeTruthy();
  expect(screen.getByText("Food & Drink")).toBeTruthy();
  expect(screen.getByText("Groceries")).toBeTruthy();
  expect(screen.getByTestId("donut")).toBeTruthy();
});

it("hides edit controls when editEnabled is false", () => {
  render(<BudgetView summary={summary} editEnabled={false} />);
  expect(screen.queryByRole("button", { name: /edit budget/i })).toBeNull();
});

it("shows '—' not 'Over' for the third metric when no budget is set", () => {
  const noBudgetSummary = {
    month: "2026-06",
    totalBudget: 0,
    totalSpent: 230,
    totalRemaining: -230,
    incomeThisMonth: 0,
    groups: [],
  };
  render(<BudgetView summary={noBudgetSummary} editEnabled={false} />);
  expect(screen.queryByText("Over")).toBeNull();
  // The "—" placeholder must appear for both Budget and Remaining metrics.
  const dashes = screen.getAllByText("—");
  expect(dashes.length).toBeGreaterThanOrEqual(2);
});

it("PUTs and refreshes when a budget is saved", async () => {
  portalFetchMock.mockResolvedValue({ ok: true });
  render(<BudgetView summary={summary} editEnabled />);
  fireEvent.click(screen.getAllByRole("button", { name: /edit budget/i })[0]);
  const input = screen.getByLabelText(/budget amount/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "750" } });
  fireEvent.click(screen.getByRole("button", { name: /save budget/i }));
  await waitFor(() => expect(portalFetchMock).toHaveBeenCalled());
  const [, init] = portalFetchMock.mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({ categoryId: "g-food", monthlyAmount: 750 });
  await waitFor(() => expect(refreshMock).toHaveBeenCalled());
});
