// @vitest-environment jsdom
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";
import { DashboardGrid } from "@/components/portal/dashboard-grid";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";

// Stub fetch so BudgetCategoryDetail (mounted by the category panel) lands in
// its loadError branch rather than throwing an unhandled-rejection in jsdom.
vi.stubGlobal(
  "fetch",
  () => Promise.reject(new Error("no fetch in test")),
);

afterEach(() => {
  vi.unstubAllGlobals();
  // Re-stub after each test so fetch is still stubbed for subsequent tests.
  vi.stubGlobal(
    "fetch",
    () => Promise.reject(new Error("no fetch in test")),
  );
});

const DTO: PortalDashboardDTO = {
  spending: { left: 1683, budgeted: 6650, spent: 4967, pace: [
    { day: 1, cumulative: 100, pace: 221 },
    { day: 2, cumulative: 250, pace: 443 },
  ], underBy: 1176, month: "2026-06", groups: [
    { id: "cat1", name: "Food", color: "var(--data-blue)", spent: 382, budget: 1500 },
  ] },
  netWorth: {
    assets: 90999, debt: 55022, netWorth: 35977, series: [], asOfDate: "2026-06-24",
    accounts: [{ id: "acct1", name: "Checking", value: 90999 }],
    debts: [{ id: "liab1", name: "Visa", value: 55022 }],
  },
  toReview: {
    count: 1,
    sample: [
      {
        id: "txn1", date: "2026-06-12", name: "WHOLEFDS", merchantName: "Whole Foods",
        amount: 84.21, accountName: "Checking",
        categoryId: null, categoryName: null, categoryColor: null,
      },
    ],
  },
  topCategories: [
    { id: "cat1", name: "Food", color: "var(--data-blue)", spent: 382, budget: 1500 },
  ],
  netThisMonth: { net: -3501, income: 0, spent: 3501, prior: -710, deltaAbs: -2790, deltaPct: 392 },
  recurrings: [
    { id: "rec1", name: "Phone", cadence: "monthly", predicted: 31.4, state: "overdue", dueDate: "2026-06-10", daysUntil: -14, postedThisMonth: 0 },
  ],
  recurringRows: [
    {
      id: "rec1", name: "Phone", cadence: "monthly", dueDay: 10, dueMonth: null,
      matchType: "contains", pattern: "phone", amountMin: 30, amountMax: 35,
      categoryId: "cat9", categoryName: "Utilities", categoryColor: "var(--data-teal)", categoryIcon: "📱",
      predicted: 31.4, state: "overdue", postedThisMonth: 0,
      nextPaymentDate: "2026-06-10",
      timeline: [{ month: "2026-06", paid: false }],
      metricsByYear: [{ year: 2026, total: 157, avg: 31.4, count: 5 }],
    },
  ],
  sharing: { shareTransactions: true, shareBudgets: true, shareRecurrings: true },
};

// The rail target is a sibling of the grid in the portal layout; the grid must
// resolve it AFTER commit (never during render) and portal the panel into it.
function LayoutLike({ editEnabled = false }: { editEnabled?: boolean }): ReactElement {
  return (
    <div>
      <main>
        <DashboardGrid dto={DTO} editEnabled={editEnabled} />
      </main>
      <aside id="portal-detail" />
    </div>
  );
}

function rail(): HTMLElement {
  const el = document.getElementById("portal-detail");
  if (!el) throw new Error("no #portal-detail in test DOM");
  return el;
}

describe("DashboardGrid chart tiles", () => {
  it("renders monthly spending, net worth, and net-this-month", () => {
    render(<LayoutLike />);
    expect(screen.getByText("Monthly spending")).toBeInTheDocument();
    expect(screen.getByText("Net worth")).toBeInTheDocument();
    expect(screen.getByText("Net this month")).toBeInTheDocument();
    expect(screen.getByText(/under pace/)).toBeInTheDocument();
  });
});

describe("DashboardGrid rail drill-downs", () => {
  it("portals the category detail into #portal-detail and closes", async () => {
    const user = userEvent.setup();
    render(<LayoutLike />);
    expect(rail()).toBeEmptyDOMElement();
    // Use exact text to avoid matching "Whole Foods" from the to-review tile.
    await user.click(screen.getByRole("button", { name: /^Food/ }));
    expect(within(rail()).getByText(/Open in Budget/)).toBeInTheDocument();
    await user.click(within(rail()).getByRole("button", { name: "Close" }));
    expect(rail()).toBeEmptyDOMElement();
  });

  it("opens the rich recurring panel from the next-two-weeks tile", async () => {
    const user = userEvent.setup();
    render(<LayoutLike />);
    await user.click(screen.getByRole("button", { name: /Phone/ }));
    expect(within(rail()).getByText("Key metrics")).toBeInTheDocument();
    expect(within(rail()).getByText(/Open in Recurrings/)).toBeInTheDocument();
  });

  it("opens a read-only transaction panel from the to-review tile", async () => {
    const user = userEvent.setup();
    render(<LayoutLike />);
    await user.click(screen.getByRole("button", { name: /Whole Foods/ }));
    expect(within(rail()).getByText(/Open in Transactions/)).toBeInTheDocument();
    expect(within(rail()).getByText("Checking")).toBeInTheDocument();
    expect(
      within(rail()).queryByRole("button", { name: /Mark as reviewed/ }),
    ).not.toBeInTheDocument();
  });

  it("marks a transaction reviewed from the panel when editing is enabled", async () => {
    type FakeFetch = (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
    const fetchMock = vi.fn<FakeFetch>((url) => {
      if (String(url).includes("/api/portal/categories")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ categories: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<LayoutLike editEnabled />);
    await user.click(screen.getByRole("button", { name: /Whole Foods/ }));
    await user.click(within(rail()).getByRole("button", { name: /Mark as reviewed/ }));
    // Optimistic: the panel closes and the row leaves the queue.
    await waitFor(() => expect(rail()).toBeEmptyDOMElement());
    expect(screen.queryByText("Whole Foods")).not.toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/portal/transactions/txn1"));
    expect(put).toBeTruthy();
    expect(JSON.parse(String(put![1]!.body))).toEqual({ reviewed: true });
  });

  it("reverts the to-review row when the reviewed PUT fails", async () => {
    const user = userEvent.setup();
    render(<LayoutLike />);
    await user.click(screen.getAllByLabelText("Mark as reviewed")[0]);
    await waitFor(() => expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument());
    expect(screen.getByText("Whole Foods")).toBeInTheDocument();
  });

  it("opens the net-worth breakdown from the net-worth tile", async () => {
    const user = userEvent.setup();
    render(<LayoutLike />);
    await user.click(screen.getByRole("button", { name: /Assets/ }));
    expect(within(rail()).getByText("Visa")).toBeInTheDocument();
    expect(within(rail()).getByText("Checking")).toBeInTheDocument();
    expect(within(rail()).getByText(/Open in Accounts/)).toBeInTheDocument();
  });

  it("opens the spending groups panel and swaps to a category detail", async () => {
    const user = userEvent.setup();
    render(<LayoutLike />);
    await user.click(screen.getByRole("button", { name: /left/ }));
    const group = within(rail()).getByRole("button", { name: /Food/ });
    await user.click(group);
    // The panel swaps to BudgetCategoryDetail (fetch is stubbed to fail →
    // its load-error branch renders).
    expect(await within(rail()).findByText(/Couldn.t load this category/)).toBeInTheDocument();
    expect(within(rail()).getByText(/Open in Budget/)).toBeInTheDocument();
  });
});
