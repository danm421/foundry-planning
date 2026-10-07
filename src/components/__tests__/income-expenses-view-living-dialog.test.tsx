// @vitest-environment jsdom
/**
 * The expense dialog's living-expense shape: a living expense neither ends at
 * Medicare nor belongs to a business, so neither control shows for one — and a
 * value left over from another type never rides along on its save. A legacy
 * living row that already ends at Medicare keeps the control so it can be
 * cleared.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c1/details/income-expenses",
}));

import IncomeExpensesView, {
  type IncomeExpensesViewProps,
} from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

type ExpenseRow = IncomeExpensesViewProps["initialExpenses"][number];

const fetchMock = vi.fn();

const BUSINESS = { id: "biz-1", name: "Sample Dental LLC", category: "business" };

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [],
  initialSavingsRules: [],
  accounts: [BUSINESS] as never,
  ownerNames: { clientName: "Cooper Sample", spouseName: "Susan Sample" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: {},
  resolvedInflationRate: 0.024,
  clientInfo: { clientRetirementYear: 2040, clientEndYear: 2075, planStartYear: 2026, planEndYear: 2075 },
};

function row(over: Partial<ExpenseRow>): ExpenseRow {
  return {
    id: "exp-1",
    name: "Current Living Expenses",
    type: "living",
    annualAmount: "180000",
    startYear: 2026,
    endYear: 2039,
    growthRate: "0.024",
    growthSource: "inflation",
    isDefault: true,
    ...over,
  } as ExpenseRow;
}

function renderView(expenses: ExpenseRow[]) {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} initialExpenses={expenses} />
    </ClientAccessProvider>,
  );
}

describe("ExpenseDialog — living expenses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "new-id" }) });
  });

  it("hides the Medicare end and business owner on a living expense", () => {
    renderView([row({})]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    expect(screen.queryByText("Ends at Medicare eligibility")).toBeNull();
    expect(document.getElementById("exp-owner-account")).toBeNull();
  });

  // The control: without it, a dialog that dropped both for EVERY type passes.
  it("keeps both on a non-living expense", () => {
    renderView([row({ id: "exp-2", name: "Health Premiums", type: "insurance", isDefault: false })]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Health Premiums" }));
    expect(screen.getByText("Ends at Medicare eligibility")).toBeInTheDocument();
    expect(document.getElementById("exp-owner-account")).not.toBeNull();
  });

  it("keeps the Medicare end on a legacy living row that already has one", () => {
    renderView([row({ endsAtMedicareEligibilityOwner: "client" })]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    expect(screen.getByLabelText("Ends at Medicare eligibility")).toBeChecked();
  });

  it("drops a Medicare end and business set under another type when saved as living", async () => {
    renderView([]);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[1]);
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "other" } });
    fireEvent.click(screen.getByLabelText("Ends at Medicare eligibility"));
    fireEvent.change(document.getElementById("exp-owner-account")!, { target: { value: "biz-1" } });

    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "living" } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Housing" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /add expense/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/expenses"));
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.type).toBe("living");
    expect(body.endsAtMedicareEligibilityOwner).toBeNull();
    expect(body.ownerAccountId).toBeNull();
  });
});
