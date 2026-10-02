// @vitest-environment jsdom
/**
 * R1 for the nested tabs the Solver's Edit picker opens through this view.
 *
 * The Income / Expense / Savings-rule Schedule tabs and the Social Security
 * dialog's Medicare tab write tables with NO scenario column
 * (`PUT/DELETE …/schedule`, `PUT /medicare-coverage`). Inside a scenario a save
 * there silently changed the base plan — and every other scenario — with no
 * Changes row. Inside a scenario they are read-only under the base-only note;
 * in base mode they still write.
 *
 * Scenario state is driven through the URL the way `useScenarioState` reads
 * it, and `use-scenario-writer` is NOT mocked, so the scenario check under test
 * is the real one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

let searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/solver",
}));

import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";

// ---------------------------------------------------------------------------
// Fixture (the focus-mode suite's rows)
// ---------------------------------------------------------------------------

const INCOME = {
  id: "inc-1",
  type: "salary" as const,
  name: "Alice Salary",
  annualAmount: "120000",
  startYear: 2024,
  endYear: 2030,
  owner: "client" as const,
  claimingAge: null,
  growthRate: "0.03",
};

const SS_INCOME = {
  id: "inc-ss-1",
  type: "social_security" as const,
  name: "Social Security",
  annualAmount: "31415",
  startYear: 2030,
  endYear: 2060,
  owner: "client" as const,
  claimingAge: 67,
  growthRate: "0.02",
  ssBenefitMode: "manual_amount",
};

const EXPENSE = {
  id: "exp-1",
  type: "other" as const,
  name: "Lake House Upkeep",
  annualAmount: "24000",
  startYear: 2024,
  endYear: 2030,
  growthRate: "0.03",
  isDefault: false,
};

const SAVINGS_RULE = {
  id: "sr-1",
  accountId: "acct-2",
  annualAmount: "6000",
  annualPercent: null,
  contributeMax: false,
  startYear: 2024,
  endYear: 2030,
  growthRate: null,
  growthSource: null,
  employerMatchPct: null,
  employerMatchCap: null,
  employerMatchAmount: null,
};

const PROPS = {
  clientId: "c1",
  initialIncomes: [INCOME, SS_INCOME],
  initialExpenses: [EXPENSE],
  initialSavingsRules: [SAVINGS_RULE],
  accounts: [
    { id: "acct-1", name: "Brokerage", category: "taxable", subType: "brokerage" },
    { id: "acct-2", name: "Alice 401k", category: "retirement", subType: "traditional_401k" },
  ],
  entities: [],
  ownerNames: { clientName: "Alice Test", spouseName: null },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: {},
  resolvedInflationRate: 0.03,
  ssClientInfo: {
    firstName: "Alice",
    lastName: "Test",
    dateOfBirth: "1960-05-15",
    retirementAge: 67,
    planEndAge: 95,
    filingStatus: "single" as const,
  },
  ssPlanSettings: {
    flatFederalRate: 0.22,
    flatStateRate: 0.05,
    inflationRate: 0.03,
    planStartYear: 2024,
    planEndYear: 2060,
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Every request the view made, as `METHOD url`. */
const requests = () =>
  fetchMock.mock.calls.map(
    ([url, init]) => `${((init as RequestInit | undefined)?.method ?? "GET").toUpperCase()} ${String(url)}`,
  );

function renderFocused(focus: EditorFocus) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <IncomeExpensesView {...PROPS} focus={focus} onFocusClose={vi.fn()} />
    </ClientAccessProvider>,
  );
}

beforeEach(() => {
  searchParams = new URLSearchParams("");
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => [], text: async () => "" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SCHEDULE_CASES = [
  { label: "income", focus: { kind: "income" as const, id: "inc-1" }, url: "/api/clients/c1/incomes/inc-1/schedule" },
  { label: "expense", focus: { kind: "expense" as const, id: "exp-1" }, url: "/api/clients/c1/expenses/exp-1/schedule" },
  {
    label: "savings rule",
    focus: { kind: "savings_rule" as const, id: "sr-1" },
    url: "/api/clients/c1/savings-rules/sr-1/schedule",
  },
];

describe("Schedule tabs inside a scenario", () => {
  it.each(SCHEDULE_CASES)("$label: read-only under the base-only note, and nothing is sent", async ({ focus }) => {
    searchParams = new URLSearchParams("scenario=scn-1");
    renderFocused(focus);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    const note = await screen.findByText("Available on the base plan.");
    expect(screen.queryByRole("button", { name: /save schedule/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /clear schedule/i })).toBeNull();
    // The schedule editor sits in the disabled fieldset right after the note
    // (the savings dialog keeps its Details form mounted beside it).
    const editor = note.nextElementSibling as HTMLElement;
    const cells = within(editor).getAllByRole("spinbutton");
    expect(cells.length).toBeGreaterThan(1);
    for (const input of cells) expect(input).toBeDisabled();
    expect(within(editor).getByRole("button", { name: /apply/i })).toBeDisabled();

    fireEvent.change(cells.at(-1)!, { target: { value: "5000" } });
    fireEvent.click(within(editor).getByRole("button", { name: /apply/i }));
    expect(requests()).toEqual([]);
  });
});

describe("Schedule tabs on the base plan", () => {
  it.each(SCHEDULE_CASES)("$label: Save Schedule still PUTs the base schedule", async ({ focus, url }) => {
    renderFocused(focus);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.queryByText("Available on the base plan.")).toBeNull();
    const firstCell = screen.getAllByRole("spinbutton").at(-1)!;
    fireEvent.change(firstCell, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /save schedule/i }));

    await waitFor(() => expect(requests()).toContain(`PUT ${url}`));
  });

  it.each(SCHEDULE_CASES)("$label: Clear Schedule still DELETEs the base schedule", async ({ focus, url }) => {
    renderFocused(focus);

    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("button", { name: /clear schedule/i }));

    await waitFor(() => expect(requests()).toContain(`DELETE ${url}`));
  });
});

describe("Social Security → Medicare tab", () => {
  it("inside a scenario: read-only under the base-only note, only the coverage read is sent", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    renderFocused({ kind: "income", id: "inc-ss-1" });

    fireEvent.click(screen.getByRole("button", { name: "Medicare" }));

    expect(await screen.findByText("Available on the base plan.")).toBeInTheDocument();
    expect(screen.getByLabelText(/enrollment year/i)).toBeDisabled();
    expect(screen.getByLabelText(/coverage type/i)).toBeDisabled();
    expect(screen.getByLabelText(/medigap monthly/i)).toBeDisabled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /^save$/i })).toBeNull();

    fireEvent.change(screen.getByLabelText(/medigap monthly/i), { target: { value: "200" } });
    // The dialog's on-mount coverage read is the whole request list.
    expect(requests().every((r) => r.startsWith("GET "))).toBe(true);
  });

  it("on the base plan: Save still PUTs the base Medicare coverage", async () => {
    renderFocused({ kind: "income", id: "inc-ss-1" });

    fireEvent.click(screen.getByRole("button", { name: "Medicare" }));
    expect(screen.queryByText("Available on the base plan.")).toBeNull();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(requests()).toContain("PUT /api/clients/c1/medicare-coverage"));
  });
});
