// src/components/portal/__tests__/budget-category-detail.test.tsx
// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));
// Stub the chart so jsdom never touches a canvas.
vi.mock("@/components/portal/budget-history-chart", () => ({
  BudgetHistoryChart: () => <div data-testid="history-chart" />,
}));

import { BudgetCategoryDetail } from "@/components/portal/budget-category-detail";

const DETAIL = {
  id: "l-groceries",
  name: "Groceries",
  slug: "food-groceries",
  color: "var(--data-orange)",
  emoji: "🥑",
  kind: "category" as const,
  monthlyBudget: 500,
  spentThisMonth: 176.21,
  remainingThisMonth: 323.79,
  history: [{ month: "2026-06", amount: 176.21, heat: "good" as const }],
  metrics: [{ year: 2026, total: 2970.41, avgMonthly: 558.84 }],
  transactions: [
    { id: "t1", date: "2026-06-07", name: "WEGMANS", merchantName: "Wegmans", amount: 68.22, categoryId: "l-groceries", categoryName: "Groceries", categoryColor: "var(--data-orange)" },
    { id: "t2", date: "2026-05-30", name: "WEGMANS 2", merchantName: "Wegmans", amount: 77.99, categoryId: "l-groceries", categoryName: "Groceries", categoryColor: "var(--data-orange)" },
  ],
};

const CATEGORIES = [
  { id: "g-food", name: "Food & Drink", kind: "group", parentId: null, color: "var(--data-orange)" },
  { id: "l-groceries", name: "Groceries", kind: "category", parentId: "g-food", color: "var(--data-orange)" },
  { id: "l-dining", name: "Dining", kind: "category", parentId: "g-food", color: "var(--data-red)" },
];

const TXN = {
  id: "t1",
  date: "2026-06-07",
  name: "WEGMANS",
  merchantName: "Wegmans",
  amount: "68.22",
  pending: false,
  excluded: false,
  categoryId: "l-groceries",
  categoryName: "Groceries",
  categoryColor: "var(--data-orange)",
  categorizedBy: "plaid",
  accountId: "a1",
  accountName: "Checking",
  accountMask: "1234",
  type: "expense",
  source: "plaid",
  reviewed: false,
};

function mockFetch(): void {
  portalFetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return Promise.resolve({ ok: true });
    if (url === "/api/portal/categories")
      return Promise.resolve({ ok: true, json: async () => ({ categories: CATEGORIES }) });
    if (url === "/api/portal/recurrings")
      return Promise.resolve({ ok: true, json: async () => ({ recurrings: [] }) });
    if (url.startsWith("/api/portal/transactions/"))
      return Promise.resolve({ ok: true, json: async () => ({ transaction: TXN }) });
    return Promise.resolve({ ok: true, json: async () => ({ detail: DETAIL }) });
  });
}

beforeEach(() => {
  portalFetchMock.mockReset();
  mockFetch();
});

it("fetches and renders header, metrics and transactions by month", async () => {
  render(
    <BudgetCategoryDetail categoryId="l-groceries" editEnabled={false} onBudgetSaved={() => {}} />,
  );
  expect(await screen.findByRole("heading", { name: "Groceries" })).toBeTruthy();
  expect(portalFetchMock).toHaveBeenCalledWith("/api/portal/budgets/category/l-groceries");
  expect(screen.getByText("$176.21")).toBeTruthy();
  expect(screen.getByText(/323\.79 left/)).toBeTruthy();
  expect(screen.getByText("$2,970.41")).toBeTruthy();
  expect(screen.getByText("$558.84")).toBeTruthy();
  expect(screen.getByText("June 2026")).toBeTruthy();
  expect(screen.getByText("May 2026")).toBeTruthy();
  expect(screen.getAllByText("Wegmans").length).toBe(2);
  expect(screen.getByText("-$68.22")).toBeTruthy();
});

it("hides the budget edit row when editEnabled is false", async () => {
  render(
    <BudgetCategoryDetail categoryId="l-groceries" editEnabled={false} onBudgetSaved={() => {}} />,
  );
  await screen.findByRole("heading", { name: "Groceries" });
  expect(screen.queryByRole("button", { name: /edit budget/i })).toBeNull();
});

it("PUTs a new budget and notifies the parent", async () => {
  const onSaved = vi.fn();
  render(
    <BudgetCategoryDetail categoryId="l-groceries" editEnabled onBudgetSaved={onSaved} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /edit budget/i }));
  const input = screen.getByLabelText(/budget amount/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "750" } });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await waitFor(() => {
    const put = portalFetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put![1].body)).toEqual({ categoryId: "l-groceries", monthlyAmount: 750 });
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it("recategorizes a transaction from the rail and notifies the parent", async () => {
  const onSaved = vi.fn();
  render(
    <BudgetCategoryDetail categoryId="l-groceries" editEnabled onBudgetSaved={onSaved} />,
  );
  await screen.findByRole("heading", { name: "Groceries" });
  fireEvent.click(screen.getAllByTitle("Change category")[0]);
  fireEvent.click(await screen.findByRole("button", { name: /dining/i }));

  await waitFor(() => {
    const put = portalFetchMock.mock.calls.find(
      (c) => c[0] === "/api/portal/transactions/t1" && c[1]?.method === "PUT",
    );
    expect(put).toBeTruthy();
    expect(JSON.parse(put![1].body)).toEqual({ categoryId: "l-dining" });
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it("keeps the read-only category chip when editing is disabled", async () => {
  render(
    <BudgetCategoryDetail categoryId="l-groceries" editEnabled={false} onBudgetSaved={() => {}} />,
  );
  await screen.findByRole("heading", { name: "Groceries" });
  expect(screen.queryByTitle("Change category")).toBeNull();
});

it("opens the transaction drawer from a transaction name", async () => {
  render(
    <BudgetCategoryDetail categoryId="l-groceries" editEnabled={false} onBudgetSaved={() => {}} />,
  );
  await screen.findByRole("heading", { name: "Groceries" });
  fireEvent.click(screen.getAllByTitle("View transaction details")[0]);

  expect(await screen.findByRole("dialog", { name: "Transaction details" })).toBeTruthy();
  expect(portalFetchMock).toHaveBeenCalledWith("/api/portal/transactions/t1");
  // Panel content from the GET payload: description row + account.
  expect(await screen.findByText("WEGMANS")).toBeTruthy();
  expect(screen.getByText("Checking")).toBeTruthy();
});
