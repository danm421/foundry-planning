// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE row's Details-page dialog.
 *
 * With `focus` set the view must render only the dialog the page's own
 * row-click would open for that row, seeded with that row, and hand control
 * back through `onFocusClose` whenever that dialog goes away (cancel, save,
 * delete) or never could open (row missing, kind not handled here).
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const submit = vi.fn();

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit, scenarioActive: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c1/solver",
}));

import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { PAGE_FOCUS_KINDS, type EditorFocus } from "@/lib/scenario/change-editor-target";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const INCOME = {
  id: "inc-1",
  type: "salary" as const,
  name: "Alice Salary",
  annualAmount: "120000",
  startYear: 2024,
  endYear: 2060,
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
  endYear: 2060,
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
  endYear: 2060,
  growthRate: null,
  growthSource: null,
  employerMatchPct: null,
  employerMatchCap: null,
  employerMatchAmount: null,
};

const ACCOUNTS = [
  { id: "acct-1", name: "Brokerage", category: "taxable", subType: "brokerage" },
  { id: "acct-2", name: "Alice 401k", category: "retirement", subType: "traditional_401k" },
];

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [INCOME, SS_INCOME],
  initialExpenses: [EXPENSE],
  initialSavingsRules: [SAVINGS_RULE],
  accounts: ACCOUNTS,
  entities: [],
  ownerNames: { clientName: "Alice Test", spouseName: null },
  incomeSchedules: {},
  expenseSchedules: {},
  // A multi-year schedule: the dialog only shows "Using custom schedule" when
  // the row's schedule reached it — a PUT without it collapses the schedule.
  savingsSchedules: {
    "sr-1": [
      { year: 2024, amount: 5000 },
      { year: 2025, amount: 7000 },
    ],
  },
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

function renderFocused(
  focus: EditorFocus,
  onFocusClose = vi.fn(),
  permission: "view" | "edit" = "edit",
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} focus={focus} onFocusClose={onFocusClose} />
    </ClientAccessProvider>,
  );
  return { ...utils, onFocusClose };
}

/** The header X of the view's hand-rolled Income / Expense dialogs. */
function headerCloseButton(title: string): HTMLElement {
  const button = screen.getByRole("heading", { name: title }).parentElement?.querySelector("button");
  if (!button) throw new Error(`no close button next to "${title}"`);
  return button;
}

beforeEach(() => {
  submit.mockReset();
  // Only the Social Security dialog fetches on mount (Medicare coverage).
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IncomeExpensesView focus mode", () => {
  it("income → the income dialog, pre-filled with that row, and nothing else", () => {
    renderFocused({ kind: "income", id: "inc-1" });

    expect(screen.getByRole("heading", { name: "Edit Income" })).toBeTruthy();
    expect((document.getElementById("inc-name") as HTMLInputElement).value).toBe("Alice Salary");
    // Page chrome stays out: no section headers, no KPI strip, no SS card.
    expect(screen.queryByText("Savings & Contributions")).toBeNull();
    expect(screen.queryByText("Net Cash Flow")).toBeNull();
    expect(screen.queryByText("Social Security")).toBeNull();
  });

  it("social_security income → the Social Security dialog for that row", () => {
    renderFocused({ kind: "income", id: "inc-ss-1" });

    expect(screen.getByText("Edit Alice's Social Security")).toBeTruthy();
    expect(screen.getByDisplayValue("31415")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Edit Income" })).toBeNull();
  });

  it("expense → the expense dialog, pre-filled with that row", () => {
    renderFocused({ kind: "expense", id: "exp-1" });

    expect(screen.getByRole("heading", { name: "Edit Expense" })).toBeTruthy();
    expect((document.getElementById("exp-name") as HTMLInputElement).value).toBe("Lake House Upkeep");
    expect(screen.queryByText("Expenses")).toBeNull();
  });

  it("savings_rule → the savings-rule dialog with that row's account AND its schedule", () => {
    renderFocused({ kind: "savings_rule", id: "sr-1" });

    expect(screen.getByText("Edit Savings Rule")).toBeTruthy();
    expect((document.getElementById("sr-account") as HTMLSelectElement).value).toBe("acct-2");
    expect(screen.getByText("Using custom schedule")).toBeTruthy();
  });

  it("a row that isn't there → onFocusClose(\"unavailable\") once, nothing rendered", async () => {
    const { container, onFocusClose, rerender } = renderFocused({ kind: "income", id: "gone" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith("unavailable");
    expect(container).toBeEmptyDOMElement();

    // A parent re-render with fresh inline props must not close it again.
    rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <IncomeExpensesView {...BASE_PROPS} focus={{ kind: "income", id: "gone" }} onFocusClose={onFocusClose} />
      </ClientAccessProvider>,
    );
    expect(onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("a kind this view doesn't edit → onFocusClose(\"unavailable\"), nothing rendered", async () => {
    const { container, onFocusClose } = renderFocused({ kind: "account", id: "acct-1" });

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith("unavailable");
    expect(container).toBeEmptyDOMElement();
  });

  it("Social Security without plan settings → unavailable, as the page shows no SS card", async () => {
    const onFocusClose = vi.fn();
    const { container } = render(
      <IncomeExpensesView
        {...BASE_PROPS}
        ssPlanSettings={undefined}
        focus={{ kind: "income", id: "inc-ss-1" }}
        onFocusClose={onFocusClose}
      />,
    );

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith("unavailable");
    expect(container).toBeEmptyDOMElement();
  });

  // The page lists these in read-only rollups with no pencil, and the dialogs
  // can't carry `ownerEntityId` — a save would drop a scenario's ownership edit.
  it.each([
    { label: "an entity-owned income", focus: { kind: "income" as const, id: "inc-trust" } },
    { label: "a business-owned expense", focus: { kind: "expense" as const, id: "exp-biz" } },
  ])("$label → unavailable, as the page offers no editor for it", async ({ focus }) => {
    const onFocusClose = vi.fn();
    const { container } = render(
      <IncomeExpensesView
        {...BASE_PROPS}
        initialIncomes={[...BASE_PROPS.initialIncomes, { ...INCOME, id: "inc-trust", ownerEntityId: "ent-1" }]}
        initialExpenses={[...BASE_PROPS.initialExpenses, { ...EXPENSE, id: "exp-biz", ownerAccountId: "biz-1" }]}
        focus={focus}
        onFocusClose={onFocusClose}
      />,
    );

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith("unavailable");
    expect(container).toBeEmptyDOMElement();
  });

  it("without edit permission → unavailable, as the page offers no editor either", async () => {
    const { container, onFocusClose } = renderFocused({ kind: "income", id: "inc-1" }, vi.fn(), "view");

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith("unavailable");
    expect(container).toBeEmptyDOMElement();
  });

  // A normal close carries no outcome at all — not even an explicit undefined.
  it("closing the income dialog calls onFocusClose()", () => {
    const { onFocusClose } = renderFocused({ kind: "income", id: "inc-1" });
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(headerCloseButton("Edit Income"));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("closing the expense dialog calls onFocusClose()", () => {
    const { onFocusClose } = renderFocused({ kind: "expense", id: "exp-1" });

    fireEvent.click(headerCloseButton("Edit Expense"));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("cancelling the savings-rule dialog calls onFocusClose()", () => {
    const { onFocusClose } = renderFocused({ kind: "savings_rule", id: "sr-1" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("cancelling the Social Security dialog calls onFocusClose()", () => {
    const { onFocusClose } = renderFocused({ kind: "income", id: "inc-ss-1" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });

  it("a successful save calls onFocusClose()", async () => {
    submit.mockResolvedValue({ ok: true, json: async () => ({ ...INCOME, name: "Alice Salary" }) });
    const { onFocusClose } = renderFocused({ kind: "income", id: "inc-1" });

    fireEvent.submit(document.getElementById("income-form-fields") as HTMLFormElement);

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "edit", targetKind: "income", targetId: "inc-1" }),
      expect.anything(),
    );
  });

  it("a confirmed delete calls onFocusClose()", async () => {
    submit.mockResolvedValue({ ok: true, status: 204 });
    const { onFocusClose } = renderFocused({ kind: "expense", id: "exp-1" });

    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(onFocusClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onFocusClose).toHaveBeenCalledTimes(1));
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(submit).toHaveBeenCalledWith(
      { op: "remove", targetKind: "expense", targetId: "exp-1" },
      expect.anything(),
    );
  });

  describe("create and delete intents", () => {
    it.each([
      { kind: "income" as const, title: "Add Income" },
      { kind: "expense" as const, title: "Add Expense" },
    ])("create $kind opens the empty dialog and closes on cancel", async ({ kind, title }) => {
      const { onFocusClose } = renderFocused({ intent: "create", kind });
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      expect(onFocusClose).not.toHaveBeenCalled();
      fireEvent.click(headerCloseButton(title));
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
      expect(onFocusClose).toHaveBeenCalledTimes(1);
    });

    it("create savings_rule opens the empty savings-rule dialog and closes on cancel", async () => {
      const { onFocusClose } = renderFocused({ intent: "create", kind: "savings_rule" });
      expect(await screen.findByText("Add Savings Rule")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    });

    it("create for a kind this view doesn't create → unavailable", async () => {
      const { onFocusClose } = renderFocused({ intent: "create", kind: "account" });
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("unavailable"));
    });

    it("delete intent removes the row with no prompt, then closes", async () => {
      submit.mockResolvedValue({ ok: true, status: 204 });
      const { onFocusClose, container } = renderFocused({ intent: "delete", kind: "expense", id: "exp-1" });
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
      expect(onFocusClose).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(
        { op: "remove", targetKind: "expense", targetId: "exp-1" },
        { url: "/api/clients/c1/expenses/exp-1", method: "DELETE" },
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    });

    it("delete intent reports a failed write without alert()", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      submit.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
      const { onFocusClose } = renderFocused({ intent: "delete", kind: "income", id: "inc-1" });
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("failed"));
      expect(onFocusClose).toHaveBeenCalledTimes(1);
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it("delete intent does not close before the delete resolves", async () => {
      let resolve!: (r: Response) => void;
      submit.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
      const { onFocusClose } = renderFocused({ intent: "delete", kind: "expense", id: "exp-1" });
      await act(async () => {});
      expect(onFocusClose).not.toHaveBeenCalled();
      resolve({ ok: true, status: 204 } as Response);
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
    });

    it("delete of a row the page can't delete (missing) → unavailable, no write", async () => {
      const { onFocusClose } = renderFocused({ intent: "delete", kind: "expense", id: "gone" });
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("unavailable"));
      expect(submit).not.toHaveBeenCalled();
    });

    it("delete of a default expense → unavailable, no write", async () => {
      const onFocusClose = vi.fn();
      render(
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <IncomeExpensesView
            {...BASE_PROPS}
            initialExpenses={[{ ...EXPENSE, id: "exp-default", isDefault: true }]}
            focus={{ intent: "delete", kind: "expense", id: "exp-default" }}
            onFocusClose={onFocusClose}
          />
        </ClientAccessProvider>,
      );
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("unavailable"));
      expect(submit).not.toHaveBeenCalled();
    });

    it("delete of a Social Security income → unavailable, no write", async () => {
      const { onFocusClose } = renderFocused({ intent: "delete", kind: "income", id: "inc-ss-1" });
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("unavailable"));
      expect(submit).not.toHaveBeenCalled();
    });

    it("delete without edit permission → unavailable, no write", async () => {
      const { onFocusClose } = renderFocused({ intent: "delete", kind: "expense", id: "exp-1" }, vi.fn(), "view");
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("unavailable"));
      expect(submit).not.toHaveBeenCalled();
    });

    it("delete whose write rejects (network error) → failed", async () => {
      submit.mockRejectedValue(new Error("network"));
      const { onFocusClose } = renderFocused({ intent: "delete", kind: "expense", id: "exp-1" });
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith("failed"));
      expect(onFocusClose).toHaveBeenCalledTimes(1);
    });

    it("delete runs once under StrictMode", async () => {
      submit.mockResolvedValue({ ok: true, status: 204 });
      const onFocusClose = vi.fn();
      render(
        <StrictMode>
          <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
            <IncomeExpensesView
              {...BASE_PROPS}
              focus={{ intent: "delete", kind: "savings_rule", id: "sr-1" }}
              onFocusClose={onFocusClose}
            />
          </ClientAccessProvider>
        </StrictMode>,
      );
      await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());
      expect(submit).toHaveBeenCalledTimes(1);
      expect(onFocusClose).toHaveBeenCalledTimes(1);
    });
  });
});

it("PAGE_FOCUS_KINDS lists the kinds this view handles", () => {
  expect(PAGE_FOCUS_KINDS["income-expenses"]).toEqual(expect.arrayContaining(["income", "expense", "savings_rule"]));
});
