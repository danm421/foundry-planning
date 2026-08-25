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
    assetGroups: [{ category: "cash", label: "Cash", total: 90999 }],
  },
  goals: [
    {
      id: "retirement", kind: "retirement", label: "Retirement", forName: null,
      startYear: 2045, endYear: 2075, cost: 3_000_000, funded: 2_400_000, pctFunded: 0.8,
    },
    {
      id: "edu1", kind: "education", label: "College", forName: "Ava",
      startYear: 2036, endYear: 2039, cost: 200_000, funded: 200_000, pctFunded: 1,
    },
  ],
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
  goalsProjected: true,
  sharing: { shareTransactions: true, shareBudgets: true, shareRecurrings: true },
  budgetEnabled: true,
};

// The rail target is a sibling of the grid in the portal layout; the grid must
// resolve it AFTER commit (never during render) and portal the panel into it.
function LayoutLike({
  editEnabled = false,
  dto = DTO,
}: {
  editEnabled?: boolean;
  dto?: PortalDashboardDTO;
}): ReactElement {
  return (
    <div>
      <main>
        <DashboardGrid dto={dto} editEnabled={editEnabled} />
      </main>
      <aside id="portal-detail" />
    </div>
  );
}

/** n rows of the to-review queue, newest-first like the loader hands them over. */
function pageOf(start: number, len: number): PortalDashboardDTO["toReview"]["sample"] {
  return Array.from({ length: len }, (_, i) => ({
    id: `txn${start + i}`,
    date: "2026-06-12",
    name: `RAW ${start + i}`,
    merchantName: `Merchant ${start + i}`,
    amount: 10 + start + i,
    accountName: "Checking",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
  }));
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

  // The first column is the plan and nothing else; every budgeting tile lives
  // in the second — on a phone the columns stack, so this split is also what
  // puts Net worth at the top of the mobile dashboard.
  it("keeps the first column to the plan and the budgeting tiles in the second", () => {
    render(<LayoutLike />);
    const grid = screen.getByTestId("dashboard-grid");
    const firstColumn = grid.firstElementChild as HTMLElement;
    expect(
      within(firstColumn)
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(["Net worth", "Goals funded"]);
    const secondColumn = grid.children[1] as HTMLElement;
    expect(
      within(secondColumn)
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
    ).toEqual([
      "Monthly spending",
      "Transactions to review",
      "Net this month",
      "Top categories",
      "Next two weeks",
    ]);
  });

  it("shows the asset-type breakdown as a pie with a legend", () => {
    render(<LayoutLike />);
    const tile = screen.getByText("Net worth").closest("section") as HTMLElement;
    expect(within(tile).getByText("By type")).toBeInTheDocument();
    expect(within(tile).getByText("Cash")).toBeInTheDocument();
    // Cash is the DTO's only asset group, so the pie is one full-turn circle.
    expect(tile.querySelector("svg circle")).not.toBeNull();
  });

  // Scoped to the tile: the net-worth pie's legend prints shares as percentages
  // too, so a bare getByText("100%") matches both tiles.
  it("shows percent funded per goal", () => {
    render(<LayoutLike />);
    const tile = within(screen.getByText("Goals funded").closest("section") as HTMLElement);
    expect(tile.getByText("80%")).toBeInTheDocument();
    expect(tile.getByText("100%")).toBeInTheDocument();
    expect(tile.getByText(/for Ava/)).toBeInTheDocument();
    expect(tile.getByText(/\$600,000 short of \$3,000,000/)).toBeInTheDocument();
  });
});

// Every budgeting tile links into /budget/*, which 404s once the advisor
// switches Budget off — a tile left behind is a dead link on the client's
// landing page.
describe("DashboardGrid with Budget switched off", () => {
  it("drops all five budgeting tiles and keeps the plan tiles", () => {
    render(
      <div>
        <main>
          <DashboardGrid dto={{ ...DTO, budgetEnabled: false }} editEnabled={false} />
        </main>
        <aside id="portal-detail" />
      </div>,
    );
    expect(screen.getByText("Net worth")).toBeInTheDocument();
    expect(screen.getByText("Goals funded")).toBeInTheDocument();
    expect(screen.queryByText("Monthly spending")).toBeNull();
    expect(screen.queryByText("Net this month")).toBeNull();
    expect(screen.queryByText("Top categories")).toBeNull();
    expect(screen.queryByText("Transactions to review")).toBeNull();
    expect(screen.queryByText("Next two weeks")).toBeNull();
  });

  it("removes the second column entirely so the first is not left at half width", () => {
    render(
      <div>
        <main>
          <DashboardGrid dto={{ ...DTO, budgetEnabled: false }} editEnabled={false} />
        </main>
        <aside id="portal-detail" />
      </div>,
    );
    expect(screen.getByTestId("dashboard-grid").children).toHaveLength(1);
  });

  it("keeps every tile when the DTO reports Budget on", () => {
    render(<LayoutLike />);
    expect(screen.getByText("Monthly spending")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-grid").children).toHaveLength(2);
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
    expect(within(rail()).getByText(/Open in Recurring/)).toBeInTheDocument();
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
    render(<LayoutLike editEnabled />);
    await user.click(screen.getAllByLabelText("Mark as reviewed")[0]);
    await waitFor(() => expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument());
    expect(screen.getByText("Whole Foods")).toBeInTheDocument();
  });

  it("marks only the rows on screen, then refills with the next page", async () => {
    // 12 in the backlog, 5 on screen: one click clears those 5 and the server
    // hands back the next 5, so the client keeps going until it hits zero.
    const page1 = pageOf(1, 5);
    const page2 = pageOf(6, 5);
    type FakeFetch = (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
    const fetchMock = vi.fn<FakeFetch>(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, marked: 5, items: page2, count: 7 }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <LayoutLike editEnabled dto={{ ...DTO, toReview: { count: 12, sample: page1 } }} />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /mark these reviewed/i }));

    // Exactly the visible ids went up — nothing the client never saw.
    const post = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/api/portal/transactions/review-queue"),
    );
    expect(post).toBeTruthy();
    expect(post![1]?.method).toBe("POST");
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      ids: ["txn1", "txn2", "txn3", "txn4", "txn5"],
    });

    // The next page lands and the count drops by the page, not to zero.
    await waitFor(() => expect(screen.getByText("Merchant 6")).toBeInTheDocument());
    expect(screen.queryByText("Merchant 1")).not.toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText(/caught up/)).not.toBeInTheDocument();
  });

  it("shows the caught-up state once the last page is marked", async () => {
    type FakeFetch = (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
    const fetchMock = vi.fn<FakeFetch>(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, marked: 2, items: [], count: 0 }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<LayoutLike editEnabled dto={{ ...DTO, toReview: { count: 2, sample: pageOf(1, 2) } }} />);
    await user.click(screen.getByRole("button", { name: /mark these reviewed/i }));
    await waitFor(() => expect(screen.getByText(/caught up/)).toBeInTheDocument());
  });

  it("puts the page back when the batch POST fails", async () => {
    type FakeFetch = (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
    const fetchMock = vi.fn<FakeFetch>(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<LayoutLike editEnabled dto={{ ...DTO, toReview: { count: 12, sample: pageOf(1, 5) } }} />);
    await user.click(screen.getByRole("button", { name: /mark these reviewed/i }));
    await waitFor(() => expect(screen.getByText(/Couldn.t save/)).toBeInTheDocument());
    expect(screen.getByText("Merchant 1")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
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
