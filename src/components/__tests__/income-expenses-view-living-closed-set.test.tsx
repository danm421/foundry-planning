// @vitest-environment jsdom
/**
 * `type: "living"` is a CLOSED SET of two rows per (client, scenario) — Current
 * (anchored `plan_start`) and Retirement (anchored `client_retirement` /
 * `spouse_retirement`) — editable in AMOUNT and TIMING only. This file pins the
 * advisor-facing half of that rule on the Inflows & Outflows page.
 *
 * The load-bearing one is the submit-body key set. The write core
 * (`lib/clients/expenses-writes.ts`) rejects a default living row's update the
 * moment it carries any key outside `LIVING_EDITABLE_FIELDS` — and the guard
 * tests the PARSED payload for `!== undefined`, so `cashAccountId: null` or
 * `dedicatedAccountIds: []` is just as fatal as a real value. The dialog used to
 * build a full body on every save, which meant an amount-only edit 400d. A test
 * that only asserted "`name` is absent" would have passed while `growthRate`
 * still 400d, so the assertion here is the EXACT key set.
 *
 * Harness follows `income-expenses-inline-write.test.tsx`: mock the scenario
 * writer, mount the whole view, drive it through the DOM.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Writer stub — hoisted so the `vi.mock` factory below can close over it.
// ---------------------------------------------------------------------------
const stub = vi.hoisted(() => {
  const calls: { edit: Record<string, unknown>; base: Record<string, unknown> }[] = [];
  const submit = (edit: unknown, base: unknown) => {
    calls.push({
      edit: edit as Record<string, unknown>,
      base: base as Record<string, unknown>,
    });
    return Promise.resolve({
      ok: true,
      json: async () => ({ id: "liv-current" }),
    } as Response);
  };
  return { calls, submit };
});

function baseBody(n: number): Record<string, unknown> {
  return stub.calls[n].base.body as Record<string, unknown>;
}

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

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: stub.submit, scenarioActive: false }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import IncomeExpensesView from "@/components/income-expenses-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { LIVING_EDITABLE_FIELDS } from "@/lib/living-expenses";
import type { ClientMilestones } from "@/lib/milestones";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MILESTONES: ClientMilestones = {
  planStart: 2026,
  planEnd: 2066,
  clientRetirement: 2035,
  clientEnd: 2060,
  clientSS62: 2028,
  clientSSFRA: 2033,
  clientSS70: 2036,
};

const CURRENT_LIVING = {
  id: "liv-current",
  type: "living" as const,
  name: "Current Living Expenses",
  annualAmount: "120000",
  startYear: 2026,
  endYear: 2035,
  growthRate: "0.03",
  growthSource: "inflation",
  startYearRef: "plan_start",
  endYearRef: "client_retirement",
  inflationStartYear: 2026,
  isDefault: true,
};

const RETIREMENT_LIVING = {
  id: "liv-retirement",
  type: "living" as const,
  name: "Retirement Living Expenses",
  annualAmount: "90000",
  startYear: 2035,
  endYear: 2066,
  growthRate: "0.03",
  growthSource: "inflation",
  startYearRef: "client_retirement",
  endYearRef: "plan_end",
  inflationStartYear: 2026,
  isDefault: true,
};

const OTHER_EXPENSE = {
  id: "exp-other",
  type: "other" as const,
  name: "Vacation Fund",
  annualAmount: "5000",
  startYear: 2026,
  endYear: 2040,
  growthRate: "0.02",
  growthSource: "custom",
  startYearRef: null,
  endYearRef: null,
  isDefault: false,
};

/**
 * Present so `BusinessOwnerSelect` actually renders — with no business account
 * it returns null and the "owner picker is hidden" assertion would be vacuous.
 */
const BUSINESS_ACCOUNT = {
  id: "acct-biz",
  name: "Cooper LLC",
  category: "business",
  subType: "s_corp",
};

const BASE_PROPS = {
  clientId: "c1",
  initialIncomes: [],
  initialExpenses: [CURRENT_LIVING, RETIREMENT_LIVING, OTHER_EXPENSE],
  initialSavingsRules: [],
  accounts: [BUSINESS_ACCOUNT],
  entities: [],
  ownerNames: { clientName: "Harold Mueller", spouseName: "Rhonda Mueller" },
  incomeSchedules: {},
  expenseSchedules: {},
  savingsSchedules: {},
  flowScenarioFields: {},
  resolvedInflationRate: 0.024,
  clientInfo: {
    clientRetirementYear: 2035,
    clientEndYear: 2060,
    planStartYear: 2026,
    planEndYear: 2066,
    milestones: MILESTONES,
  },
};

type Props = React.ComponentProps<typeof IncomeExpensesView>;

function renderView(overrides: Partial<Props> = {}, permission: "edit" | "view" = "edit") {
  render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <IncomeExpensesView {...BASE_PROPS} {...overrides} />
    </ClientAccessProvider>,
  );
}

/** The `Group` header row that carries a label + subtotal. */
function groupHeader(label: string): HTMLElement {
  return screen.getByText(label).closest("div")!.parentElement!;
}

/**
 * The open dialog's Details form. Every dialog query goes through it: the row
 * behind the dialog carries the same name text and its own year-cell buttons,
 * so an unscoped `screen` query matches both and the assertion stops
 * discriminating.
 */
function dialogForm(): HTMLElement {
  return document.getElementById("expense-form-fields")!;
}

beforeEach(() => {
  stub.calls.length = 0;
});

// ---------------------------------------------------------------------------
// The acceptance criterion: the submit body
// ---------------------------------------------------------------------------

describe("default living row — submit body", () => {
  it("sends ONLY the five editable keys, so the write core cannot 400 it", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "130000" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(stub.calls).toHaveLength(1));

    // Derived from the canonical set, not retyped: a second copy of the rule is
    // exactly the drift the plan's Global Constraint forbids.
    expect(Object.keys(baseBody(0)).sort()).toEqual([...LIVING_EDITABLE_FIELDS].sort());
  });

  it("carries the edited amount and the row's anchors", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
    fireEvent.change(screen.getByLabelText(/annual amount/i), { target: { value: "130000" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(stub.calls).toHaveLength(1));

    // The key-set assertion above would still pass on a body of five EMPTY
    // values, so name what actually has to reach the route.
    //
    // `endYear` is 2034, not the fixture's 2035: `MilestoneYearPicker` resolves
    // a TRANSITION ref in end position to `year - 1` ("last year before client
    // retirement") and normalises the field on open. Pre-existing behaviour of
    // every milestone-anchored row in this dialog, asserted here so the pinned
    // value isn't mistaken for a typo.
    expect(baseBody(0)).toEqual({
      annualAmount: "130000",
      startYear: "2026",
      endYear: "2034",
      startYearRef: "plan_start",
      endYearRef: "client_retirement",
    });
  });

  it("keeps the INLINE amount edit inside the editable set too", async () => {
    // Living rows are the only ones with an inline amount editor, so this is
    // the commonest living-row write of all — and it takes a different code
    // path (`saveExpenseField`) from the dialog above.
    renderView({
      flowScenarioFields: { [CURRENT_LIVING.id]: { annualAmount: "120000", name: "Current Living Expenses" } },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Edit amount for Current Living Expenses" }),
    );
    const input = screen.getByRole("textbox", { name: "Amount for Current Living Expenses" });
    fireEvent.change(input, { target: { value: "130000" } });
    fireEvent.blur(input);

    await waitFor(() => expect(stub.calls).toHaveLength(1));

    expect(baseBody(0)).toEqual({ annualAmount: "130000" });
  });

  it("still sends the full body for a non-living row", async () => {
    // Regression pin on the narrowing itself: it must not leak to rows the
    // write core happily accepts a full body for.
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit Vacation Fund" }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(stub.calls).toHaveLength(1));

    expect(baseBody(0)).toMatchObject({ type: "other", name: "Vacation Fund" });
    expect(Object.keys(baseBody(0)).length).toBeGreaterThan(LIVING_EDITABLE_FIELDS.size);
  });
});

// ---------------------------------------------------------------------------
// The dialog: amount + timing only
// ---------------------------------------------------------------------------

describe("default living row — edit dialog", () => {
  beforeEach(() => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit Current Living Expenses" }));
  });

  it("shows the amount field and both year pickers", () => {
    const form = within(dialogForm());
    expect(form.getByLabelText(/annual amount/i)).toBeInTheDocument();
    expect(form.getByLabelText("Start Year")).toHaveValue(2026);
    expect(form.getByLabelText("End Year")).toBeInTheDocument();
  });

  it("names the row and explains why the rest is fixed", () => {
    const form = within(dialogForm());
    expect(form.getByText("Current Living Expenses")).toBeInTheDocument();
    expect(form.getByText(/fixed to two rows/i)).toBeInTheDocument();
  });

  it("hides every control the write core rejects", () => {
    const form = within(dialogForm());
    expect(form.queryByLabelText("Type")).toBeNull();
    expect(form.queryByLabelText(/^name/i)).toBeNull();
    expect(form.queryByLabelText(/show as a goal/i)).toBeNull();
    // Exact-cased: the caption paragraph says "growth rate" in prose, and a
    // case-insensitive match would find that instead of the control's label.
    expect(form.queryByText("Growth Rate")).toBeNull();
    expect(form.queryByLabelText("Tax Treatment")).toBeNull();
    expect(form.queryByText(/ends at medicare eligibility/i)).toBeNull();
    expect(form.queryByText(/today's dollars/i)).toBeNull();
    expect(form.queryByLabelText(/owned by business/i)).toBeNull();
  });

  it("offers no delete", () => {
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});

describe("non-living row — edit dialog is untouched", () => {
  // The mirror of "hides every control": without it, deleting the controls
  // outright would pass the whole suite above.
  it("still renders every control the living dialog hides", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit Vacation Fund" }));

    const form = within(dialogForm());
    expect(form.getByLabelText("Type")).toBeInTheDocument();
    expect(form.getByLabelText(/^name/i)).toBeInTheDocument();
    expect(form.getByLabelText(/show as a goal/i)).toBeInTheDocument();
    expect(form.getByText("Growth Rate")).toBeInTheDocument();
    expect(form.getByLabelText("Tax Treatment")).toBeInTheDocument();
    expect(form.getByText(/ends at medicare eligibility/i)).toBeInTheDocument();
    expect(form.getByText(/today's dollars/i)).toBeInTheDocument();
    expect(form.getByLabelText(/owned by business/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The list: no create affordance, read-only rate
// ---------------------------------------------------------------------------

describe("living expenses are not creatable", () => {
  it("drops Living Expense from the Add dialog's type picker", () => {
    renderView();
    // The Expenses panel's "+ Add" is the second one (Income panel is first).
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[1]);

    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Living Expense" })).toBeNull();
  });

  it("gives the Living Expenses group no + button", () => {
    renderView();

    expect(screen.queryByRole("button", { name: "Add to Living Expenses" })).toBeNull();
  });

  it("still gives the other expense groups a + button", () => {
    // Discriminates "living has no add" from "the add affordance is gone".
    renderView();

    expect(screen.getByRole("button", { name: "Add to Other Expenses" })).toBeInTheDocument();
  });
});

describe("living rows have a read-only rate cell", () => {
  it("reads Inflation with no editor", () => {
    renderView();

    expect(
      screen.queryByRole("button", { name: "Change growth rate for Current Living Expenses" }),
    ).toBeNull();
    expect(screen.getAllByText("Inflation")).toHaveLength(2);
  });

  it("leaves a non-living row's rate editable", () => {
    renderView();

    expect(
      screen.getByRole("button", { name: "Change growth rate for Vacation Fund" }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Hiding the Current row once its window is empty
// ---------------------------------------------------------------------------

const RETIRED_CLIENT_INFO = {
  ...BASE_PROPS.clientInfo,
  clientRetirementYear: 2026,
  milestones: { ...MILESTONES, clientRetirement: 2026 },
};

describe("Current living row once retirement is at or before plan start", () => {
  it("shows both rows while retirement is still ahead", () => {
    renderView();

    expect(screen.getByText("Current Living Expenses")).toBeInTheDocument();
    expect(screen.getByText("Retirement Living Expenses")).toBeInTheDocument();
  });

  it("hides the Current row", () => {
    renderView({ clientInfo: RETIRED_CLIENT_INFO });

    expect(screen.queryByText("Current Living Expenses")).toBeNull();
    expect(screen.getByText("Retirement Living Expenses")).toBeInTheDocument();
  });

  it("drops it from the group subtotal too", () => {
    renderView({ clientInfo: RETIRED_CLIENT_INFO });

    // $90,000, not $210,000 — the header has to agree with what is on screen.
    expect(within(groupHeader("Living Expenses")).getByText("$90,000")).toBeInTheDocument();
  });

  it("keys the hide on the row's ANCHOR, not on its name", () => {
    // A renamed Current row still hides; role comes from `start_year_ref`.
    renderView({
      clientInfo: RETIRED_CLIENT_INFO,
      initialExpenses: [
        { ...CURRENT_LIVING, name: "Household Spending" },
        RETIREMENT_LIVING,
        OTHER_EXPENSE,
      ],
    });

    expect(screen.queryByText("Household Spending")).toBeNull();
  });

  it("keeps a row named like the Current slot but anchored at retirement", () => {
    // The mirror image: name says Current, anchor says Retirement. Hiding it
    // would delete a live row from the advisor's view.
    renderView({
      clientInfo: RETIRED_CLIENT_INFO,
      initialExpenses: [
        { ...RETIREMENT_LIVING, name: "Current Living Expenses" },
        OTHER_EXPENSE,
      ],
    });

    expect(screen.getByText("Current Living Expenses")).toBeInTheDocument();
  });
});
