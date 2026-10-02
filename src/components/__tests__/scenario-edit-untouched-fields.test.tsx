// @vitest-environment jsdom
/**
 * Browser pass A: editing one field inside a scenario also recorded a second
 * field as null — `inflationStartYear` on an income amount edit, `growthRate`
 * on a default-growth account's value edit. The dialogs' scenario edits no
 * longer send those untouched nulls (base-mode bodies are unchanged).
 *
 * `?scenario=` drives the REAL `useScenarioWriter`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

let searchParams = new URLSearchParams("scenario=scn-1");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/solver",
}));

import IncomeExpensesView from "@/components/income-expenses-view";
import AddAccountForm from "@/components/forms/add-account-form";
import { ClientAccessProvider } from "@/components/client-access-provider";

let fetchMock: ReturnType<typeof vi.fn>;
/** The `desiredFields` of every scenario edit POSTed to the changes route. */
const editedFields = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith("/scenarios/scn-1/changes") && (init as RequestInit)?.method === "POST")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    .filter((b) => b.op === "edit")
    .map((b) => b.desiredFields as Record<string, unknown>);

beforeEach(() => {
  searchParams = new URLSearchParams("scenario=scn-1");
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Income dialog — scenario edit fields", () => {
  const INCOME = {
    id: "inc-1",
    type: "salary" as const,
    name: "Cooper's Salary",
    annualAmount: "250000",
    startYear: 2026,
    endYear: 2040,
    owner: "client" as const,
    claimingAge: null,
    growthRate: "0.03",
    // Stored as the start year itself: "inflate from start", not today's dollars.
    inflationStartYear: 2026,
  };

  function renderIncome(row = INCOME) {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView
          clientId="c1"
          initialIncomes={[row]}
          initialExpenses={[]}
          initialSavingsRules={[]}
          accounts={[]}
          entities={[]}
          ownerNames={{ clientName: "Cooper", spouseName: null }}
          incomeSchedules={{}}
          expenseSchedules={{}}
          savingsSchedules={{}}
          flowScenarioFields={{}}
          resolvedInflationRate={0.03}
          focus={{ kind: "income", id: row.id }}
          onFocusClose={vi.fn()}
        />
      </ClientAccessProvider>,
    );
  }

  it("an amount edit sends no restated `inflationStartYear: null`", async () => {
    renderIncome();
    fireEvent.change(screen.getByDisplayValue("250000"), { target: { value: "111111" } });
    fireEvent.submit(document.getElementById("income-form-fields") as HTMLFormElement);

    await waitFor(() => expect(editedFields()).toHaveLength(1));
    expect(editedFields()[0]).toMatchObject({ annualAmount: "111111" });
    expect(editedFields()[0]).not.toHaveProperty("inflationStartYear");
  });
});

describe("Account dialog — scenario edit fields", () => {
  it("a value edit on a default-growth account sends no `growthRate: null`", async () => {
    render(
      <AddAccountForm
        clientId="c1"
        category="taxable"
        mode="edit"
        initial={{
          id: "acct-1",
          name: "Taxable Account",
          category: "taxable",
          subType: "brokerage",
          owner: "client",
          value: "185405.09",
          basis: "100000",
          growthRate: null,
          growthSource: "default",
          owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
        }}
        familyMembers={[{ id: "fm-c", role: "client", firstName: "Cooper" }]}
        entities={[]}
      />,
    );
    fireEvent.change(screen.getByDisplayValue("185405.09"), { target: { value: "1111111" } });
    await act(async () => {
      fireEvent.submit(document.getElementById("add-account-form") as HTMLFormElement);
    });

    await waitFor(() => expect(editedFields()).toHaveLength(1));
    expect(editedFields()[0]).toMatchObject({ value: "1111111", growthSource: "default" });
    expect(editedFields()[0]).not.toHaveProperty("growthRate");
  });
});
