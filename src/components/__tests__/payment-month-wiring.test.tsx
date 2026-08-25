// @vitest-environment jsdom
/**
 * The "Paid in" control WIRED INTO both flow dialogs.
 *
 * `payment-month-select.test.tsx` renders the control in isolation, so every
 * one of its assertions still passes if the control is never placed in either
 * dialog. These tests drive the real `IncomeExpensesView` and assert both
 * directions of the round trip:
 *
 *   OUT — a month chosen in the dialog reaches the request body as a NUMBER.
 *   BACK IN — a row that already carries a month reopens on that month.
 *
 * The two BACK IN tests hand-build their row, so they do NOT catch
 * `view-adapters.ts` dropping the field — MEASURED: with both adapter lines
 * deleted they stay green. Only the adapter-composition block at the bottom of
 * this file covers that, and it is where the reasoning for it is written down.
 *
 * That failure is worth naming here anyway, because it is what the whole file
 * exists to prevent: the dialog would hydrate from a view row that never
 * carried the field, reopen on "Monthly", and — because the write layer applies
 * the column whenever the key is present — null the stored month on save.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn();

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { expenseEngineToView, incomeEngineToView } from "@/lib/scenario/view-adapters";
import type { Expense as EngineExpense, Income as EngineIncome } from "@/engine/types";

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [],
  initialExpenses: [],
  initialSavingsRules: [],
  accounts: [],
  ownerNames: { clientName: "Harold Mueller", spouseName: "Rhonda Mueller" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: {},
  resolvedInflationRate: 0.024,
};

function renderView(props: Record<string, unknown> = {}) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} {...props} />
    </ClientAccessProvider>,
  );
}

/** [0] is the Income panel's "+ Add", [1] is the Expenses panel's. */
function openAdd(which: "income" | "expense") {
  const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
  fireEvent.click(addButtons[which === "income" ? 0 : 1]);
}

function sentBodyFor(path: string) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes(path));
  expect(call).toBeTruthy();
  return JSON.parse((call![1] as RequestInit).body as string);
}

describe("Paid in month — wired into the income dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-income-id", ok: true, targetId: "new-income-id" }),
    });
  });

  it("sends the chosen month as a number on the income payload", async () => {
    renderView();
    openAdd("income");

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Bonus" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText("Paid in"), { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: /add income/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(sentBodyFor("/incomes").paymentMonth).toBe(3);
  });

  it("reopens an income that already has a month on that month", () => {
    renderView({
      initialIncomes: [
        {
          id: "inc-1",
          type: "other",
          name: "Bonus",
          annualAmount: "20000",
          startYear: 2026,
          endYear: 2040,
          owner: "client",
          claimingAge: null,
          growthRate: "0.02",
          paymentMonth: 11,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Bonus" }));

    expect((screen.getByLabelText("Paid in") as HTMLSelectElement).value).toBe("11");
  });

  // The DESTRUCTIVE scenario itself, on the update branch. Every other test
  // here submits from `+ Add`; this one reopens a row that already has a month
  // and saves it untouched. `incomes-writes.ts:209` writes the column whenever
  // the key is present, so a payload that reached this point carrying `null`
  // would erase the advisor's choice on a no-op Save.
  it("keeps the stored month on the payload when a dated row is saved untouched", async () => {
    renderView({
      initialIncomes: [
        {
          id: "inc-1",
          type: "other",
          name: "Bonus",
          annualAmount: "20000",
          startYear: 2026,
          endYear: 2040,
          owner: "client",
          claimingAge: null,
          growthRate: "0.02",
          paymentMonth: 11,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Bonus" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(sentBodyFor("/incomes").paymentMonth).toBe(11);
  });
});

describe("Paid in month — wired into the expense dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-expense-id", ok: true, targetId: "new-expense-id" }),
    });
  });

  it("sends the chosen month as a number on the expense payload", async () => {
    renderView();
    openAdd("expense");

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Property tax" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "8000" } });
    fireEvent.change(screen.getByLabelText("Paid in"), { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: /add expense/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(sentBodyFor("/expenses").paymentMonth).toBe(3);
  });

  it("reopens an expense that already has a month on that month", () => {
    renderView({
      initialExpenses: [
        {
          id: "exp-1",
          type: "other",
          name: "Property tax",
          annualAmount: "8000",
          startYear: 2026,
          endYear: 2055,
          growthRate: "0.02",
          paymentMonth: 11,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Property tax" }));

    expect((screen.getByLabelText("Paid in") as HTMLSelectElement).value).toBe("11");
  });
});

/**
 * The two "reopens …" tests above hand-build their row, so they pass even if
 * `view-adapters.ts` drops `paymentMonth` — MEASURED: deleting both adapter
 * lines leaves all four of them green. These two close that gap by hydrating
 * the view exactly as the real pages do (`IncomeExpensesViewProps` documents
 * `initialIncomes` / `initialExpenses` as adapter output), so they go red if
 * EITHER the adapter or the dialog loses the field.
 */
describe("Paid in month — hydrated through the engine→view adapters", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });

  it("reopens an income on its stored month when the row came through incomeEngineToView", () => {
    const engineIncome: EngineIncome = {
      id: "inc-1",
      type: "other",
      name: "Bonus",
      annualAmount: 20_000,
      startYear: 2026,
      endYear: 2040,
      growthRate: 0.02,
      owner: "client",
      paymentMonth: 11,
    };
    renderView({ initialIncomes: [incomeEngineToView(engineIncome)] });

    fireEvent.click(screen.getByRole("button", { name: "Edit Bonus" }));

    expect((screen.getByLabelText("Paid in") as HTMLSelectElement).value).toBe("11");
  });

  it("reopens an expense on its stored month when the row came through expenseEngineToView", () => {
    const engineExpense: EngineExpense = {
      id: "exp-1",
      type: "other",
      name: "Property tax",
      annualAmount: 8_000,
      startYear: 2026,
      endYear: 2055,
      growthRate: 0.02,
      paymentMonth: 11,
    };
    renderView({ initialExpenses: [expenseEngineToView(engineExpense)] });

    fireEvent.click(screen.getByRole("button", { name: "Edit Property tax" }));

    expect((screen.getByLabelText("Paid in") as HTMLSelectElement).value).toBe("11");
  });
});
