// @vitest-environment jsdom
/**
 * The guided-setup wizard's Goals step renders IncomeExpensesView with
 * `section="goals"`. What that section owes the advisor:
 *   1. Only goal rows — education (always a goal) plus anything flagged
 *      isGoal — and NOT the ordinary expenses or the income/savings panels.
 *   2. A flagged non-education row lands under "Other Goals" rather than being
 *      dropped for not being type `other`.
 *   3. Adding from the section pre-ticks "Show as a goal", so a row created
 *      here actually shows up as one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c1/onboarding/goals",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn();

import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

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

const EXPENSES = [
  {
    id: "exp-living",
    type: "living" as const,
    name: "Housing",
    annualAmount: "60000",
    startYear: 2026,
    endYear: 2060,
    growthRate: "0.02",
  },
  {
    id: "exp-edu",
    type: "education" as const,
    name: "Caroline - Education",
    annualAmount: "38000",
    startYear: 2032,
    endYear: 2035,
    growthRate: "0.05",
    isGoal: false,
  },
  {
    id: "exp-goal",
    type: "other" as const,
    name: "Lake House",
    annualAmount: "250000",
    startYear: 2030,
    endYear: 2030,
    growthRate: "0.02",
    isGoal: true,
  },
  {
    id: "exp-flagged-living",
    type: "living" as const,
    name: "Sabbatical Year",
    annualAmount: "40000",
    startYear: 2034,
    endYear: 2034,
    growthRate: "0.02",
    isGoal: true,
  },
];

function renderGoals() {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView
        {...BASE_PROPS}
        initialExpenses={EXPENSES}
        embed="wizard"
        section="goals"
      />
    </ClientAccessProvider>,
  );
}

describe("IncomeExpensesView goals section", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-expense-id", ok: true, targetId: "new-expense-id" }),
    });
  });

  it("shows goal rows only, and drops the income / savings panels", () => {
    renderGoals();

    expect(screen.getByText("Caroline - Education")).toBeInTheDocument();
    expect(screen.getByText("Lake House")).toBeInTheDocument();
    // Ordinary expense — belongs to the Cash Flow step, not this one.
    expect(screen.queryByText("Housing")).not.toBeInTheDocument();
    expect(screen.queryByText("Income")).not.toBeInTheDocument();
    expect(screen.queryByText("Savings & Contributions")).not.toBeInTheDocument();
  });

  it("files a flagged non-education row under Other Goals", () => {
    renderGoals();

    // Group headers are siblings of their rows inside the group wrapper, so
    // walk up from the header to the group and assert membership there — a
    // page-wide getByText would pass no matter which group the row landed in.
    const otherGoals = screen.getByText("Other Goals").closest("div")!.parentElement!.parentElement!;
    expect(within(otherGoals).getByText("Lake House")).toBeInTheDocument();
    expect(within(otherGoals).getByText("Sabbatical Year")).toBeInTheDocument();
    expect(within(otherGoals).queryByText("Caroline - Education")).not.toBeInTheDocument();
  });

  it("pre-ticks 'Show as a goal' when adding from the Other Goals group", async () => {
    renderGoals();

    fireEvent.click(screen.getByRole("button", { name: "Add to Other Goals" }));
    expect(screen.getByLabelText(/show as a goal/i)).toBeChecked();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Boat" } });
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "80000" } });
    fireEvent.click(screen.getByRole("button", { name: /add expense/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/expenses"));
    const sentBody = JSON.parse((call![1] as RequestInit).body as string);
    expect(sentBody.isGoal).toBe(true);
    expect(sentBody.type).toBe("other");
  });

  it("keeps the full layout when the section is cash-flow", () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView
          {...BASE_PROPS}
          initialExpenses={EXPENSES}
          embed="wizard"
          section="cash-flow"
        />
      </ClientAccessProvider>,
    );

    expect(screen.getByText("Housing")).toBeInTheDocument();
    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.queryByText("Other Goals")).not.toBeInTheDocument();
  });
});
