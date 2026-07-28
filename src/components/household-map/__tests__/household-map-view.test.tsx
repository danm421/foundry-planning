// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import HouseholdMapView from "../household-map-view";
import type { HouseholdMapProps, MapItem, MapPerson } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";
import type { ExpenseView, IncomeView, SavingsRuleView } from "@/lib/scenario/view-adapters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/client-1/details/map",
}));

// Mock the dialogs/drawer at the module boundary and capture the props each
// was rendered with, so assertions can prove ROUTING (which editor opened,
// for which id) rather than merely "something opened".
vi.mock("@/components/add-account-dialog", () => ({
  default: (props: { open: boolean }) => (
    <div data-testid="mock-add-account-dialog" data-open={String(props.open)} />
  ),
}));

vi.mock("@/components/forms/savings-rule-dialog", () => ({
  default: (props: { open: boolean; editing?: { id: string; annualAmount: string } }) => (
    <div
      data-testid="mock-savings-rule-dialog"
      data-open={String(props.open)}
      data-editing-id={props.editing?.id ?? ""}
      data-editing-amount={props.editing?.annualAmount ?? ""}
    />
  ),
}));

vi.mock("../quick-edit-drawer", () => ({
  default: (props: {
    target: {
      kind: string;
      id: string | null;
      presetColumn: string;
      row: { annualAmount: string } | null;
    };
  }) => (
    <div
      data-testid="mock-quick-edit-drawer"
      data-kind={props.target.kind}
      data-id={props.target.id ?? ""}
      data-preset-column={props.target.presetColumn}
      data-row-amount={props.target.row?.annualAmount ?? ""}
    />
  ),
}));

function person(overrides: Partial<MapPerson> = {}): MapPerson {
  return {
    familyMemberId: "fm-default",
    firstName: "Alex",
    age: 45,
    retirementYear: 2045,
    birthYear: 1980,
    ...overrides,
  };
}

function item(overrides: Partial<MapItem> & Pick<MapItem, "id" | "kind" | "column">): MapItem {
  return {
    category: "investments",
    name: "Item",
    valueLabel: "$0",
    value: 0,
    splitChip: null,
    trayOwnerLabel: null,
    noteChip: null,
    ...overrides,
  };
}

function goal(overrides: Partial<MapGoal> & Pick<MapGoal, "id">): MapGoal {
  return {
    year: 2030,
    kind: "household",
    side: "client",
    title: "Goal title",
    detail: null,
    expenseId: null,
    forFamilyMemberName: null,
    ...overrides,
  };
}

function incomeRow(id: string, overrides: Partial<IncomeView> = {}): IncomeView {
  return {
    id,
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

function expenseRow(id: string, overrides: Partial<ExpenseView> = {}): ExpenseView {
  return {
    id,
    type: "other",
    name: "Expense",
    annualAmount: "24000",
    startYear: 2026,
    endYear: 2056,
    growthRate: "0.03",
    growthSource: "custom",
    startYearRef: null,
    endYearRef: null,
    isGoal: false,
    isDefault: false,
    ...overrides,
  };
}

function savingsRow(id: string, overrides: Partial<SavingsRuleView> = {}): SavingsRuleView {
  return {
    id,
    accountId: "acct-1",
    annualAmount: "5000",
    startYear: 2026,
    endYear: 2045,
    employerMatchPct: null,
    employerMatchCap: null,
    employerMatchAmount: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<HouseholdMapProps> = {}): HouseholdMapProps {
  return {
    clientId: "client-1",
    people: {
      client: person({ familyMemberId: "fm-client", firstName: "Alex" }),
      spouse: person({ familyMemberId: "fm-spouse", firstName: "Jordan" }),
      children: [],
    },
    netWorthLabel: "$500,000",
    items: [],
    goals: [],
    canEdit: true,
    incomeRows: {},
    expenseRows: {},
    savingsRuleRows: {},
    accountOptions: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HouseholdMapView — Task 11 card-click and add-button routing", () => {
  it("clicking an income card opens the drawer with kind 'income' and the item's id — DISCRIMINATING case, see report for break/restore evidence", () => {
    const items = [
      item({ id: "inc-1", kind: "income", column: "client", name: "Salary", value: 90000 }),
    ];
    render(
      <HouseholdMapView {...baseProps({ items, incomeRows: { "inc-1": incomeRow("inc-1") } })} />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByText("Salary"));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("income");
    expect(drawer.dataset.id).toBe("inc-1");
  });

  it("clicking an expense card opens the drawer with kind 'expense', not 'income'", () => {
    const items = [
      item({ id: "exp-1", kind: "expense", column: "joint", name: "Mortgage payment", value: -24000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({ items, expenseRows: { "exp-1": expenseRow("exp-1") } })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByText("Mortgage payment"));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("expense");
    expect(drawer.dataset.id).toBe("exp-1");
  });

  it("hands the drawer the SCENARIO-EFFECTIVE row from props, not a base-case fetch", () => {
    const items = [
      item({ id: "exp-1", kind: "expense", column: "joint", name: "Mortgage payment", value: -31000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({
          items,
          // The effective row carries the scenario's override, not the base value.
          expenseRows: { "exp-1": expenseRow("exp-1", { annualAmount: "31000" }) },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByText("Mortgage payment"));

    expect(screen.getByTestId("mock-quick-edit-drawer").dataset.rowAmount).toBe("31000");
  });

  it("clicking a savings card opens SavingsRuleDialog editing that specific rule, hydrated from props", () => {
    const items = [
      item({ id: "sav-1", kind: "savings", column: "client", name: "401k contribution", value: -5000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({
          items,
          savingsRuleRows: { "sav-1": savingsRow("sav-1", { annualAmount: "7500" }) },
        })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByText("401k contribution"));

    const dialog = screen.getByTestId("mock-savings-rule-dialog");
    expect(dialog.dataset.editingId).toBe("sav-1");
    expect(dialog.dataset.editingAmount).toBe("7500");
  });

  // `effectiveTree` synthesizes `source: "policy"` rows (premium-<uuid> expenses,
  // policy-income-<uuid> incomes) that have no DB row, so no write route accepts
  // their ids. `map-content.tsx` gives them no hydration entry — but the card
  // must stay, because a premium is a real outflow and dropping it would
  // understate the band. Non-interactive, not absent.
  it("a synthesized policy row (no hydration entry) renders inert — not a button — yet still counts in the band subtotal", () => {
    const items = [
      item({
        id: "exp-1",
        kind: "expense",
        column: "joint",
        name: "Mortgage payment",
        value: -24000,
      }),
      item({
        id: "premium-3f1c2b7e-0000-4000-8000-000000000000",
        kind: "expense",
        column: "joint",
        category: "insurance",
        name: "Term policy premium",
        value: -1200,
      }),
    ];
    render(
      <HouseholdMapView
        // Only the real expense gets a hydration row — exactly what
        // map-content.tsx's `source !== "policy"` filter produces.
        {...baseProps({ items, expenseRows: { "exp-1": expenseRow("exp-1") } })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));

    const band = screen.getByTestId("band-expense");
    // Still rendered, and still in the subtotal: 24,000 + 1,200.
    expect(within(band).getByText("Term policy premium")).toBeInTheDocument();
    expect(band.querySelector("b")?.textContent).toBe("($25,200)");

    // The writable sibling IS a button; the synthesized row is NOT.
    expect(screen.getByRole("button", { name: /Mortgage payment/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Term policy premium/ })).not.toBeInTheDocument();

    // And clicking it opens nothing.
    fireEvent.click(screen.getByText("Term policy premium"));
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  it("a savings card with no hydration row opens no dialog and is not a button", () => {
    const items = [
      item({ id: "sav-orphan", kind: "savings", column: "client", name: "Orphan contribution" }),
    ];
    render(<HouseholdMapView {...baseProps({ items })} />);

    fireEvent.click(screen.getByText("Cash Flow"));

    expect(screen.queryByRole("button", { name: /Orphan contribution/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Orphan contribution"));
    expect(screen.queryByTestId("mock-savings-rule-dialog")).not.toBeInTheDocument();
  });

  it("a goal card with an expenseId opens the drawer for that expense, kind 'expense'", () => {
    const g = goal({ id: "g1", side: "client", expenseId: "exp-42", title: "College fund" });
    render(
      <HouseholdMapView
        {...baseProps({ goals: [g], expenseRows: { "exp-42": expenseRow("exp-42") } })}
      />,
    );

    fireEvent.click(screen.getByText("Goals"));
    fireEvent.click(screen.getByText("College fund"));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("expense");
    expect(drawer.dataset.id).toBe("exp-42");
  });

  it("a life-milestone goal card (expenseId null) is not clickable and opens nothing", () => {
    const g = goal({ id: "g2", side: "client", expenseId: null, title: "Alex retires" });
    render(<HouseholdMapView {...baseProps({ goals: [g] })} />);

    fireEvent.click(screen.getByText("Goals"));

    expect(screen.queryByRole("button", { name: /Alex retires/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Alex retires"));
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  it("cards are not clickable when canEdit is false", () => {
    const items = [
      item({ id: "inc-1", kind: "income", column: "client", name: "Salary", value: 90000 }),
    ];
    render(
      <HouseholdMapView
        {...baseProps({ items, canEdit: false, incomeRows: { "inc-1": incomeRow("inc-1") } })}
      />,
    );

    fireEvent.click(screen.getByText("Cash Flow"));

    expect(screen.queryByRole("button", { name: /Salary/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Salary"));
    expect(screen.queryByTestId("mock-quick-edit-drawer")).not.toBeInTheDocument();
  });

  it("Net Worth board's '+ Add' opens AddAccountDialog in create mode, plain (no column/category preset — AddAccountDialog has no prop for one)", () => {
    render(<HouseholdMapView {...baseProps()} />);
    // Default board is Net Worth.
    const addButtons = screen.getAllByRole("button", { name: "+ Add" });
    fireEvent.click(addButtons[0]);

    const dialog = screen.getByTestId("mock-add-account-dialog");
    expect(dialog.dataset.open).toBe("true");
  });

  it("account and liability cards navigate to the Net Worth detail page instead of opening an in-place dialog", () => {
    const items = [
      item({ id: "a1", kind: "account", column: "client", name: "Brokerage account", value: 100000 }),
      item({
        id: "l1",
        kind: "liability",
        column: "client",
        category: "debt",
        name: "Mortgage debt",
        value: -50000,
      }),
    ];
    render(<HouseholdMapView {...baseProps({ items })} />);
    // Default board is Net Worth.
    const clientColumn = screen.getByTestId("column-client");
    const links = within(clientColumn).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/clients/client-1/details/net-worth");
    }
    // Still no in-place account dialog — the full editor lives on that page.
    expect(screen.queryByTestId("mock-add-account-dialog")?.getAttribute("data-open")).not.toBe(
      "true",
    );
  });
});
