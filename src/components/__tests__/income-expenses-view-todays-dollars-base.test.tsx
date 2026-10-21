// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/details/income-expenses",
}));

import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

// "Start the plan next year": an amount entered in today's dollars is THIS
// year's dollars. Stored as the plan's start year instead, a row starting in
// the first plan year would store base === start, read back as "not today's
// dollars", and inflate one year short after the January roll-forward.

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "inc-1" }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Income dialog — today's dollars on a plan that starts next year", () => {
  it("saves today's dollars as this year's dollars", async () => {
    const row = {
      id: "inc-1", type: "salary" as const, name: "Salary", annualAmount: "200000",
      startYear: 2027, endYear: 2040, owner: "client" as const, claimingAge: null,
      growthRate: "0.03", inflationStartYear: 2026,
    };
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView
          clientId="c1"
          initialIncomes={[row]}
          initialExpenses={[]}
          initialSavingsRules={[]}
          accounts={[]}
          entities={[]}
          ownerNames={{ clientName: "Ada", spouseName: null }}
          incomeSchedules={{}}
          expenseSchedules={{}}
          savingsSchedules={{}}
          flowScenarioFields={{}}
          resolvedInflationRate={0.03}
          clientInfo={{ clientRetirementYear: 2040, clientEndYear: 2060, planStartYear: 2027, planEndYear: 2060 }}
          focus={{ kind: "income", id: row.id }}
          onFocusClose={vi.fn()}
        />
      </ClientAccessProvider>,
    );
    fireEvent.submit(document.getElementById("income-form-fields") as HTMLFormElement);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/clients/c1/incomes/inc-1")).toBe(true),
    );
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url) === "/api/clients/c1/incomes/inc-1")!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ startYear: "2027", inflationStartYear: 2026 });
  });
});
