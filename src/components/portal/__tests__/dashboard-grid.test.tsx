// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { DashboardGrid } from "@/components/portal/dashboard-grid";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";

// Stub fetch so BudgetCategoryDetail (mounted by the category drawer) lands in
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
  ], underBy: 1176, month: "2026-06" },
  netWorth: { assets: 90999, debt: 55022, netWorth: 35977, series: [], asOfDate: "2026-06-24" },
  toReview: {
    count: 1,
    sample: [
      { id: "txn1", date: "2026-06-12", name: "WHOLEFDS", merchantName: "Whole Foods", amount: 84.21, accountName: "Checking" },
    ],
  },
  topCategories: [
    { id: "cat1", name: "Food", color: "var(--data-blue)", spent: 382, budget: 1500 },
  ],
  netThisMonth: { net: -3501, income: 0, spent: 3501, prior: -710, deltaAbs: -2790, deltaPct: 392 },
  recurrings: [
    { id: "rec1", name: "Phone", cadence: "monthly", predicted: 31.4, state: "overdue", dueDate: "2026-06-10", daysUntil: -14, postedThisMonth: 0 },
  ],
};

describe("DashboardGrid chart tiles", () => {
  it("renders monthly spending, net worth, and net-this-month", () => {
    render(<DashboardGrid dto={DTO} />);
    expect(screen.getByText("Monthly spending")).toBeInTheDocument();
    expect(screen.getByText("Net worth")).toBeInTheDocument();
    expect(screen.getByText("Net this month")).toBeInTheDocument();
    expect(screen.getByText(/under pace/)).toBeInTheDocument();
  });
});

describe("DashboardGrid drawer", () => {
  it("opens a category drawer on row click and closes on Close", async () => {
    const user = userEvent.setup();
    render(<DashboardGrid dto={DTO} />);
    // Use exact text to avoid matching "Whole Foods" from the to-review tile.
    await user.click(screen.getByRole("button", { name: /^Food/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Open in Budget/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a recurring drawer with the bill detail", async () => {
    const user = userEvent.setup();
    render(<DashboardGrid dto={DTO} />);
    await user.click(screen.getByRole("button", { name: /Phone/ }));
    expect(screen.getByText(/Open in Recurrings/)).toBeInTheDocument();
  });

  it("opens a transaction drawer from the to-review tile", async () => {
    const user = userEvent.setup();
    render(<DashboardGrid dto={DTO} />);
    await user.click(screen.getByRole("button", { name: /Whole Foods/ }));
    expect(screen.getByText(/Open in Transactions/)).toBeInTheDocument();
  });
});
