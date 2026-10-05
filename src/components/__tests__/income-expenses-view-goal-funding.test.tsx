// @vitest-environment jsdom
/**
 * Funding on an Other goal in the Inflows & Outflows expense dialog (spec
 * 2026-10-05-solver-goals-design, §2). Asserted on the SAVE payload — what
 * reaches the API — plus what the picker offers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details/income-expenses",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

const fetchMock = vi.fn();
const NOW = new Date().getFullYear();
const FM_CLIENT = "55555555-5555-4555-8555-555555555555";

const ACCOUNTS = [
  { id: "acct-brk", name: "Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberIds: [FM_CLIENT], isDefaultChecking: false },
  { id: "acct-529", name: "College 529", category: "education_savings", subType: "529", ownerFamilyMemberIds: [] },
  { id: "acct-chk", name: "Household Checking", category: "cash", subType: "checking", ownerFamilyMemberIds: [FM_CLIENT], isDefaultChecking: true },
];

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [],
  initialExpenses: [],
  initialSavingsRules: [],
  accounts: ACCOUNTS,
  ownerNames: { clientName: "Harold Mueller", spouseName: null },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: {},
  resolvedInflationRate: 0.024,
  familyMembers: [{ id: FM_CLIENT, firstName: "Harold", role: "client", dateOfBirth: `${NOW - 50}-03-02` }],
};

function openOtherGoal() {
  render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} />
    </ClientAccessProvider>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[1]);
  fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: "other" } });
  fireEvent.click(screen.getByLabelText(/show as a goal/i));
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "New car" } });
  fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "60000" } });
}

async function saveAndReadBody(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: /add expense/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/expenses"));
  return JSON.parse((call![1] as RequestInit).body as string);
}

describe("ExpenseDialog funding for an Other goal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-expense-id", ok: true, targetId: "new-expense-id" }),
    });
  });

  it("offers savings accounts, never a 529 or the main checking account", () => {
    openOtherGoal();
    expect(screen.getByRole("checkbox", { name: "Brokerage" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "College 529" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Household Checking" })).toBeNull();
  });

  it("saves the picked account with the shortfall toggle on by default", async () => {
    openOtherGoal();
    fireEvent.click(screen.getByRole("checkbox", { name: "Brokerage" }));
    expect((screen.getByLabelText(/pay shortfall out of pocket/i) as HTMLInputElement).checked).toBe(true);
    const body = await saveAndReadBody();
    expect(body).toMatchObject({
      type: "other",
      isGoal: true,
      dedicatedAccountIds: ["acct-brk"],
      payShortfallOutOfPocket: true,
    });
  });

  it("clears the links when the expense stops being a goal", async () => {
    openOtherGoal();
    fireEvent.click(screen.getByRole("checkbox", { name: "Brokerage" }));
    fireEvent.click(screen.getByLabelText(/show as a goal/i)); // uncheck
    const body = await saveAndReadBody();
    expect(body).toMatchObject({ isGoal: false, dedicatedAccountIds: [], payShortfallOutOfPocket: false });
  });
});
