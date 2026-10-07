// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// Set per test to render the page inside a scenario (`?scenario=<id>`).
let scenarioParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: vi.fn((k: string) => (k === "scenario" ? scenarioParam : null)),
    toString: () => "",
  }),
  usePathname: () => "/clients/c1/details/income-expenses",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const fetchMock = vi.fn();

import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

const HOUSING = { id: "i1", name: "Housing", amount: 3200, frequency: "monthly" as const };
const TRAVEL = { id: "i2", name: "Travel", amount: 12000, frequency: "annual" as const };

const CURRENT = {
  id: "liv-cur",
  type: "living" as const,
  name: "Current Living Expenses",
  annualAmount: "50400",
  startYear: 2026,
  endYear: 2041,
  growthRate: "0.03",
  growthSource: "inflation",
  startYearRef: "plan_start",
  endYearRef: "client_retirement",
  isDefault: true,
  livingItems: [HOUSING, TRAVEL],
};
const RETIREMENT = {
  id: "liv-ret",
  type: "living" as const,
  name: "Retirement Living Expenses",
  annualAmount: "95000",
  startYear: 2042,
  endYear: 2066,
  growthRate: "0.03",
  startYearRef: "client_retirement",
  endYearRef: "plan_end",
  isDefault: true,
};

function renderPage(expenses: Record<string, unknown>[]) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView
        clientId="c1"
        initialIncomes={[]}
        initialExpenses={expenses as never}
        initialSavingsRules={[]}
        accounts={[]}
        ownerNames={{ clientName: "Harold Mueller", spouseName: "Rhonda Mueller" }}
        incomeSchedules={{}}
        expenseSchedules={{}}
        savingsSchedules={{}}
        // Base mode still refuses an inline write for a row with no entry.
        flowScenarioFields={Object.fromEntries(expenses.map((e) => [e.id as string, {}]))}
        resolvedInflationRate={0.024}
      />
    </ClientAccessProvider>,
  );
}

/** Parsed bodies of every request with this method to this URL, in call order. */
function bodies(method: string, url: string): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([u, init]) => u === url && init?.method === method)
    .map(([, init]) => JSON.parse(init.body as string));
}

const ROW_URL = "/api/clients/c1/expenses/liv-cur";

describe("Income & Expenses — Current living items", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    scenarioParam = null;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "new-expense-id" }) });
  });

  it("offers the chevron on the Current row only", () => {
    renderPage([CURRENT, RETIREMENT]);
    expect(screen.getByRole("button", { name: "Show items for Current Living Expenses" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show items for Retirement Living Expenses" })).not.toBeInTheDocument();
  });

  it("labels an itemized row and locks its amount", () => {
    renderPage([CURRENT]);
    expect(screen.getByText("2 items · set by items")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit amount for Current Living Expenses" })).not.toBeInTheDocument();
  });

  it("says when another screen set the total", () => {
    renderPage([{ ...CURRENT, annualAmount: "90000" }]);
    expect(screen.getByText("2 items · total set elsewhere")).toBeInTheDocument();
  });

  it("saves the whole list and its total when an item is deleted", async () => {
    renderPage([CURRENT]);
    fireEvent.click(screen.getByRole("button", { name: "Show items for Current Living Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Travel" }));
    await waitFor(() => expect(bodies("PUT", ROW_URL)).toHaveLength(1));
    expect(bodies("PUT", ROW_URL)[0]).toEqual({ livingItems: [HOUSING], annualAmount: "38400" });
    expect(await screen.findByText("1 item · set by items")).toBeInTheDocument();
  });

  it("'Use items total' writes only the total", async () => {
    renderPage([{ ...CURRENT, annualAmount: "90000" }]);
    fireEvent.click(screen.getByRole("button", { name: "Show items for Current Living Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Use items total" }));
    await waitFor(() => expect(bodies("PUT", ROW_URL)).toEqual([{ annualAmount: "50400" }]));
  });

  it("deleting the last item un-itemizes the row at $0 and unlocks the amount", async () => {
    renderPage([{ ...CURRENT, annualAmount: "38400", livingItems: [HOUSING] }]);
    fireEvent.click(screen.getByRole("button", { name: "Show items for Current Living Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Housing" }));
    await waitFor(() => expect(bodies("PUT", ROW_URL)[0]).toEqual({ livingItems: null, annualAmount: "0" }));
    expect(await screen.findByRole("button", { name: "Edit amount for Current Living Expenses" })).toBeInTheDocument();
  });

  it("the first item on an un-itemized row replaces the typed total", async () => {
    renderPage([{ ...CURRENT, annualAmount: "70000", livingItems: null }]);
    expect(screen.getByRole("button", { name: "Edit amount for Current Living Expenses" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show items for Current Living Expenses" }));
    fireEvent.change(screen.getByLabelText("New item name"), { target: { value: "Groceries" } });
    fireEvent.change(screen.getByLabelText("New item amount"), { target: { value: "1400" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add item" }));
    await waitFor(() => expect(bodies("PUT", ROW_URL)).toHaveLength(1));
    const body = bodies("PUT", ROW_URL)[0];
    expect(body.annualAmount).toBe("16800");
    expect(body.livingItems).toEqual([expect.objectContaining({ name: "Groceries", amount: 1400, frequency: "monthly" })]);
  });

  it("an absorbing row keeps 'Whatever's left' and still expands", () => {
    renderPage([{ ...CURRENT, absorbsRemainingCashFlow: true }]);
    expect(screen.getByText("Whatever’s left")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show items for Current Living Expenses" }));
    expect(within(screen.getByTestId("living-items")).getByLabelText("Name of Housing")).toBeInTheDocument();
  });

  // A scenario save hands back only the dialog's fields, which carry neither
  // the items nor isDefault; the row must keep both.
  it("saving the row's editor in a scenario keeps its items and chevron", async () => {
    scenarioParam = "s1";
    renderPage([CURRENT]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Expense" })).toBeNull());
    expect(screen.getByRole("button", { name: "Show items for Current Living Expenses" })).toBeInTheDocument();
    expect(screen.getByText("2 items · set by items")).toBeInTheDocument();
  });

  it("the edit window shows the amount as set by items", () => {
    renderPage([CURRENT]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    expect(screen.getByText("Set by items — expand the row to change them.")).toBeInTheDocument();
    expect(document.getElementById("exp-amount")).toBeNull();
  });
});

describe("Make it a goal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    scenarioParam = null;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "new-expense-id" }) });
  });

  function openGoal() {
    renderPage([CURRENT]);
    fireEvent.click(screen.getByRole("button", { name: "Show items for Current Living Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Make Travel a goal" }));
  }

  it("opens a new goal pre-filled from the item", () => {
    openGoal();
    expect(screen.getByRole("heading", { name: "Add Expense" })).toBeInTheDocument();
    // By id: the expanded list also has inputs labelled "Name of …".
    expect(document.getElementById("exp-name")).toHaveValue("Travel");
    expect(document.getElementById("exp-amount")).toHaveValue("12,000");
    expect(screen.getByLabelText(/show as a goal/i)).toBeChecked();
  });

  it("saves the goal first, then removes the item", async () => {
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(bodies("PUT", ROW_URL)).toHaveLength(1));

    const goal = bodies("POST", "/api/clients/c1/expenses")[0];
    expect(goal).toMatchObject({ name: "Travel", type: "other", isGoal: true, startYear: "2026", endYear: "2041" });
    expect(Number(goal.annualAmount)).toBe(12000);
    expect(bodies("PUT", ROW_URL)[0]).toEqual({ livingItems: [HOUSING], annualAmount: "38400" });

    const order = fetchMock.mock.calls.map(([u, init]) => `${init?.method} ${u}`);
    expect(order.indexOf("POST /api/clients/c1/expenses")).toBeLessThan(order.indexOf(`PUT ${ROW_URL}`));
  });

  it("closing the editor without saving leaves the item in place", () => {
    openGoal();
    // The editor has no Cancel button; its header X (unlabelled) closes it.
    const header = screen.getByRole("heading", { name: "Add Expense" }).parentElement!;
    fireEvent.click(within(header).getByRole("button"));
    expect(bodies("PUT", ROW_URL)).toHaveLength(0);
    expect(screen.getByLabelText("Name of Travel")).toBeInTheDocument();
  });

  it("says so when the goal saved but the item could not be removed", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? { ok: false, json: async () => ({ error: "nope" }) }
        : { ok: true, json: async () => ({ id: "new-expense-id" }) },
    );
    openGoal();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The goal was saved, but Travel is still in living expenses — remove it there.",
    );
  });
});
