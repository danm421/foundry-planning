// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HouseholdMapView from "../household-map-view";
import type { HouseholdMapProps, MapItem, MapPerson } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";

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
  default: (props: { open: boolean; editing?: { id: string } }) => (
    <div
      data-testid="mock-savings-rule-dialog"
      data-open={String(props.open)}
      data-editing-id={props.editing?.id ?? ""}
    />
  ),
}));

vi.mock("../quick-edit-drawer", () => ({
  default: (props: { target: { kind: string; id: string | null; presetColumn: string } }) => (
    <div
      data-testid="mock-quick-edit-drawer"
      data-kind={props.target.kind}
      data-id={props.target.id ?? ""}
      data-preset-column={props.target.presetColumn}
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
    ...overrides,
  };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("HouseholdMapView — Task 11 card-click and add-button routing", () => {
  it("clicking an income card opens the drawer with kind 'income' and the item's id — DISCRIMINATING case, see report for break/restore evidence", () => {
    const items = [
      item({ id: "inc-1", kind: "income", column: "client", name: "Salary", value: 90000 }),
    ];
    render(<HouseholdMapView {...baseProps({ items })} />);

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
    render(<HouseholdMapView {...baseProps({ items })} />);

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByText("Mortgage payment"));

    const drawer = screen.getByTestId("mock-quick-edit-drawer");
    expect(drawer.dataset.kind).toBe("expense");
    expect(drawer.dataset.id).toBe("exp-1");
  });

  it("clicking a savings card opens SavingsRuleDialog editing that specific rule", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/savings-rules")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: "sav-1", accountId: "a1", annualAmount: "5000" }],
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }) as unknown as typeof fetch;

    const items = [
      item({ id: "sav-1", kind: "savings", column: "client", name: "401k contribution", value: -5000 }),
    ];
    render(<HouseholdMapView {...baseProps({ items })} />);

    fireEvent.click(screen.getByText("Cash Flow"));
    fireEvent.click(screen.getByText("401k contribution"));

    const dialog = await screen.findByTestId("mock-savings-rule-dialog");
    expect(dialog.dataset.editingId).toBe("sav-1");
  });

  it("a goal card with an expenseId opens the drawer for that expense, kind 'expense'", () => {
    const g = goal({ id: "g1", side: "client", expenseId: "exp-42", title: "College fund" });
    render(<HouseholdMapView {...baseProps({ goals: [g] })} />);

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
    render(<HouseholdMapView {...baseProps({ items, canEdit: false })} />);

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

  it("account and liability card clicks stay inert — a deliberate Task 11 decision (see report): opening AddAccountDialog/AddLiabilityDialog in edit mode needs an owners[] array these props don't carry, and reconstructing it risks silently overwriting real ownership on save", () => {
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
    expect(screen.queryByRole("button", { name: /Brokerage account/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mortgage debt/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-add-account-dialog")?.getAttribute("data-open")).not.toBe(
      "true",
    );
  });
});
