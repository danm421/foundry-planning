// @vitest-environment jsdom
/**
 * TDD test for income dialog: "Survivor benefit %" input appears only for
 * deferred-type incomes with a single owner (client or spouse), is hidden
 * for Joint and non-deferred types, and round-trips percent <-> fraction
 * correctly (display = percent, payload = fraction) on submit.
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

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

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
  resolvedInflationRate: 0.024,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncomeDialog survivor benefit %", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-income-id", ok: true, targetId: "new-income-id" }),
    });
  });

  it("hides the field by default (type=salary)", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    expect(screen.queryByLabelText(/survivor benefit/i)).not.toBeInTheDocument();
  });

  it("shows the field for deferred + single owner, hides for deferred + joint", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: "deferred" } });

    // Default owner is "client" — a single owner — so the field should appear.
    expect(screen.getByLabelText(/survivor benefit/i)).toBeInTheDocument();

    // Switch to Joint — field should disappear.
    fireEvent.click(screen.getByText("Joint 50/50"));
    expect(screen.queryByLabelText(/survivor benefit/i)).not.toBeInTheDocument();

    // Switch back to spouse — field should reappear.
    fireEvent.click(screen.getByText("Rhonda"));
    expect(screen.getByLabelText(/survivor benefit/i)).toBeInTheDocument();
  });

  it("sends survivorshipPct as a fraction string for a deferred single-owner income", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: "deferred" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Pension" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText(/survivor benefit/i), { target: { value: "50" } });

    fireEvent.click(screen.getByRole("button", { name: /add income/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/incomes"));
    expect(call).toBeTruthy();
    const sentBody = JSON.parse((call![1] as RequestInit).body as string);
    expect(sentBody.survivorshipPct).toBe("0.5");
  });

  it("nulls out survivorshipPct when the owner is switched to Joint after typing a value", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: "deferred" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Pension" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "10000" } });
    // Enter a survivor benefit while owner is a single person…
    fireEvent.change(screen.getByLabelText(/survivor benefit/i), { target: { value: "50" } });
    // …then switch to Joint, which hides the field. The stale input must NOT
    // leak into the payload.
    fireEvent.click(screen.getByText("Joint 50/50"));
    expect(screen.queryByLabelText(/survivor benefit/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add income/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/incomes"));
    expect(call).toBeTruthy();
    const sentBody = JSON.parse((call![1] as RequestInit).body as string);
    expect(sentBody.survivorshipPct).toBeNull();
  });

  it("omits survivorshipPct (null) for a non-deferred income even if a value was typed", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} />
      </ClientAccessProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: /^\+ Add$/ });
    fireEvent.click(addButtons[0]);

    // Type deferred first to expose + fill the field, then switch to salary,
    // which hides it — the payload must send null for the non-deferred type.
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: "deferred" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Salary" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText(/survivor benefit/i), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: "salary" } });
    expect(screen.queryByLabelText(/survivor benefit/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add income/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/incomes"));
    expect(call).toBeTruthy();
    const sentBody = JSON.parse((call![1] as RequestInit).body as string);
    expect(sentBody.survivorshipPct).toBeNull();
  });

  it("pre-fills the field as a whole-number percent when editing an existing deferred income", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView
          {...BASE_PROPS}
          initialIncomes={[
            {
              id: "inc-1",
              type: "deferred",
              name: "Pension",
              annualAmount: "10000",
              startYear: 2040,
              endYear: 2060,
              owner: "client",
              claimingAge: null,
              growthRate: "0.02",
              survivorshipPct: "0.5",
            },
          ]}
        />
      </ClientAccessProvider>,
    );

    fireEvent.click(screen.getByText("Pension"));

    expect(screen.getByLabelText(/survivor benefit/i)).toHaveValue(50);
  });
});
