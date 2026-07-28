// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuickEditDrawer from "../quick-edit-drawer";
import type { ClientMilestones } from "@/lib/milestones";
import type { ExpenseView, IncomeView } from "@/lib/scenario/view-adapters";

// `vi.hoisted` so the hoisted `vi.mock` factory can close over a value the
// tests mutate per case (a bare `let` would still be in its TDZ when the
// factory first runs).
const nav = vi.hoisted(() => ({ scenario: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === "scenario" ? nav.scenario : null),
    toString: () => (nav.scenario ? `scenario=${nav.scenario}` : ""),
  }),
  usePathname: () => "/clients/client-1/details/map",
}));

const milestones: ClientMilestones = {
  planStart: 2026,
  planEnd: 2066,
  clientRetirement: 2045,
  clientEnd: 2066,
};

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  nav.scenario = null;
  vi.restoreAllMocks();
});

function expenseRow(overrides: Partial<ExpenseView> = {}): ExpenseView {
  return {
    id: "exp-1",
    type: "other",
    name: "Expense",
    annualAmount: "10000",
    startYear: 2028,
    endYear: 2030,
    startYearRef: null,
    endYearRef: null,
    growthRate: "0.03",
    growthSource: "custom",
    isGoal: false,
    isDefault: false,
    ...overrides,
  };
}

function incomeRow(overrides: Partial<IncomeView> = {}): IncomeView {
  return {
    id: "inc-1",
    type: "salary",
    name: "Salary",
    annualAmount: "90000",
    startYear: 2026,
    endYear: 2045,
    owner: "client",
    claimingAge: null,
    growthRate: "0.03",
    growthSource: "inflation",
    startYearRef: null,
    endYearRef: null,
    ...overrides,
  };
}

function renderExpense(row: ExpenseView) {
  return render(
    <QuickEditDrawer
      clientId="client-1"
      target={{ kind: "expense", id: row.id, row, presetColumn: "joint" }}
      clientFirstName="Alex"
      spouseFirstName="Jordan"
      milestones={milestones}
      onClose={() => {}}
    />,
  );
}

/** Captures every `fetch` call so a test can pick the write it cares about by
 *  URL rather than by call index. */
function captureFetch() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    // Pre-fix, the drawer GET-ed the base-case list endpoint on mount. Answer
    // it with the BASE row so a regression to that read path is visible as
    // base numbers landing in the write payload (see the save-path test).
    if (String(url).endsWith("/expenses")) {
      return {
        ok: true,
        json: async () => [expenseRow({ id: "exp-1", name: "Mortgage", annualAmount: "24000" })],
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return calls;
}

describe("QuickEditDrawer — goal checkbox (Task 11 brief, Step 2)", () => {
  it("is checked AND disabled for an education expense, with the locked-goal helper text", () => {
    renderExpense(expenseRow({ id: "exp-1", type: "education", name: "College" }));

    const checkbox = screen.getByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Education expenses are always goals/)).toBeInTheDocument();
  });

  it("is UNCHECKED and editable for a non-education, non-goal expense — the discriminating case", () => {
    renderExpense(expenseRow({ id: "exp-2", type: "other", name: "New roof", isGoal: false }));

    const checkbox = screen.getByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeDisabled();
    expect(screen.queryByText(/Education expenses are always goals/)).not.toBeInTheDocument();
  });

  it("is checked (but still editable) for a non-education expense that already opted in via isGoal", () => {
    renderExpense(expenseRow({ id: "exp-3", type: "other", name: "Boat", isGoal: true }));

    const checkbox = screen.getByRole("checkbox", { name: /Show as a goal/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).not.toBeDisabled();
  });

  it("does not render an Owner select for an expense (owner is incomes-only)", () => {
    renderExpense(expenseRow({ id: "exp-4", type: "living", name: "Rent" }));

    expect(screen.getByRole("checkbox", { name: /Show as a goal/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
  });

  it("renders an Owner select (Client/Spouse/Joint) for an income and no goal checkbox", () => {
    const row = incomeRow({ owner: "spouse" });
    render(
      <QuickEditDrawer
        clientId="client-1"
        target={{ kind: "income", id: row.id, row, presetColumn: "joint" }}
        clientFirstName="Alex"
        spouseFirstName="Jordan"
        milestones={milestones}
        onClose={() => {}}
      />,
    );

    const ownerSelect = screen.getByLabelText("Owner");
    expect((ownerSelect as HTMLSelectElement).value).toBe("spouse");
    expect(screen.queryByText("Show as a goal")).not.toBeInTheDocument();
  });
});

describe("QuickEditDrawer — save path", () => {
  // The drawer submits EVERY field it renders, and the scenario changes-writer
  // replaces the change payload wholesale. So if the form were hydrated from
  // the base-case list-GET (as it was pre-fix), a save inside a scenario would
  // write base values over that scenario's own overrides — pressing Save with
  // no edits at all would silently revert the scenario. This test pins the
  // effective row as the hydration source by making the base row differ.
  it("scenario mode: submits the EFFECTIVE row's values, not the base case's", async () => {
    nav.scenario = "sc-1";
    const calls = captureFetch();

    // Effective (scenario) row — every field differs from the base row the
    // captured fetch would answer a list-GET with.
    const row = expenseRow({
      id: "exp-1",
      name: "Mortgage (scenario)",
      annualAmount: "31000",
      startYear: 2031,
      endYear: 2051,
      growthRate: "0.05",
      isGoal: true,
    });
    renderExpense(row);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/changes"))).toBe(true);
    });

    const write = calls.find((c) => c.url.includes("/changes"))!;
    expect(write.url).toBe("/api/clients/client-1/scenarios/sc-1/changes");
    const body = JSON.parse(String(write.init?.body)) as {
      op: string;
      targetKind: string;
      targetId: string;
      desiredFields: Record<string, unknown>;
    };
    expect(body.op).toBe("edit");
    expect(body.targetKind).toBe("expense");
    expect(body.targetId).toBe("exp-1");
    expect(body.desiredFields.name).toBe("Mortgage (scenario)");
    expect(body.desiredFields.annualAmount).toBe("31000");
    expect(body.desiredFields.startYear).toBe("2031");
    expect(body.desiredFields.endYear).toBe("2051");
    expect(body.desiredFields.growthRate).toBe("0.05");
    expect(body.desiredFields.isGoal).toBe(true);
  });

  it("never fetches on mount — the effective row arrives as a prop", () => {
    const calls = captureFetch();
    renderExpense(expenseRow({ id: "exp-1" }));
    expect(calls).toHaveLength(0);
  });
});

describe("QuickEditDrawer — delete confirmation", () => {
  it("requires a second, confirming click before deleting, and Cancel backs out", async () => {
    const calls = captureFetch();
    renderExpense(expenseRow({ id: "exp-1", name: "New roof" }));

    // First click only arms the confirm — nothing is written.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText("Delete?")).toBeInTheDocument();

    // Cancel disarms it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);

    // Arm again, then confirm — now the DELETE goes out.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/clients/client-1/expenses/exp-1");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("hides Delete entirely for a protected default expense", () => {
    renderExpense(expenseRow({ id: "exp-1", isDefault: true, name: "Living expenses" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
