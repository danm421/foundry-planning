// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CashFlowBoard from "../cash-flow-board";
import type { HouseholdMapProps, MapItem, MapPerson } from "@/lib/household-map/types";

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

function item(overrides: Partial<MapItem> & Pick<MapItem, "id" | "column" | "kind">): MapItem {
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
    // Editor hydration rows (see HouseholdMapProps). Empty by default — these
    // boards render cards, they don't hydrate editors.
    incomeRows: {},
    expenseRows: {},
    savingsRuleRows: {},
    savingsSchedules: {},
    accountOptions: [],
    // Required on `HouseholdMapProps` as of Task 5. This board does not read
    // either one — they are here so the fixture typechecks against the shared
    // props type, which is the point of having a shared props type.
    accountRows: {},
    growthContext: {
      modelPortfolios: [],
      fundPortfolios: [],
      resolvedInflationRate: 0.025,
      categoryDefaults: {},
    },
    categoryDefaultRates: {},
    resolvedInflationRate: 0.03,
    familyMemberOptions: [],
    entityOptions: [],
    ...overrides,
  };
}

/** Mirrors `net-worth-board.test.tsx`'s `subtotalTextFor` — one `<b>` per
 *  band (the bold subtotal), so its parent's full text content is the
 *  reliable way to assert a combined "label · $amount" string across the
 *  split text nodes. */
function subtotalTextFor(container: HTMLElement, bandKey: string): string | null {
  const bandEl = container.querySelector(`[data-testid="band-${bandKey}"]`);
  const bold = bandEl?.querySelector("b");
  return bold?.parentElement?.textContent ?? null;
}

describe("CashFlowBoard", () => {
  it("each kind lands in its own band, not the others", () => {
    const items: MapItem[] = [
      item({ id: "inc-1", kind: "income", column: "client", name: "Salary", value: 90000 }),
      item({ id: "sav-1", kind: "savings", column: "client", name: "401k contribution", value: -9000 }),
      item({ id: "exp-1", kind: "expense", column: "joint", name: "Mortgage payment", value: -24000 }),
    ];

    render(<CashFlowBoard {...baseProps({ items })} />);

    const incomeBand = screen.getByTestId("band-income");
    const savingsBand = screen.getByTestId("band-savings");
    const expenseBand = screen.getByTestId("band-expense");

    expect(within(incomeBand).getByText("Salary")).toBeInTheDocument();
    expect(within(incomeBand).queryByText("401k contribution")).not.toBeInTheDocument();
    expect(within(incomeBand).queryByText("Mortgage payment")).not.toBeInTheDocument();

    expect(within(savingsBand).getByText("401k contribution")).toBeInTheDocument();
    expect(within(savingsBand).queryByText("Salary")).not.toBeInTheDocument();
    expect(within(savingsBand).queryByText("Mortgage payment")).not.toBeInTheDocument();

    expect(within(expenseBand).getByText("Mortgage payment")).toBeInTheDocument();
    expect(within(expenseBand).queryByText("Salary")).not.toBeInTheDocument();
    expect(within(expenseBand).queryByText("401k contribution")).not.toBeInTheDocument();
  });

  it("cards land in the owner column their `column` says, asserted by DOM position", () => {
    const items: MapItem[] = [
      item({ id: "inc-client", kind: "income", column: "client", name: "Alex salary", value: 90000 }),
      item({ id: "inc-joint", kind: "income", column: "joint", name: "Rental income", value: 18000 }),
      item({ id: "inc-spouse", kind: "income", column: "spouse", name: "Jordan salary", value: 70000 }),
    ];

    render(<CashFlowBoard {...baseProps({ items })} />);

    const clientCol = screen.getByTestId("band-income-column-client");
    const jointCol = screen.getByTestId("band-income-column-joint");
    const spouseCol = screen.getByTestId("band-income-column-spouse");

    expect(within(clientCol).getByText("Alex salary")).toBeInTheDocument();
    expect(within(clientCol).queryByText("Rental income")).not.toBeInTheDocument();
    expect(within(clientCol).queryByText("Jordan salary")).not.toBeInTheDocument();

    expect(within(jointCol).getByText("Rental income")).toBeInTheDocument();
    expect(within(jointCol).queryByText("Alex salary")).not.toBeInTheDocument();
    expect(within(jointCol).queryByText("Jordan salary")).not.toBeInTheDocument();

    expect(within(spouseCol).getByText("Jordan salary")).toBeInTheDocument();
    expect(within(spouseCol).queryByText("Alex salary")).not.toBeInTheDocument();
    expect(within(spouseCol).queryByText("Rental income")).not.toBeInTheDocument();
  });

  // The amendment's whole purpose: an entity-owned flow (`column: "tray"`)
  // must render in its band's tray row and must NOT be dropped — nor may it
  // leak into an owner column. This is the strongest test in the file.
  it("an entity-owned income flow renders in the Income band's tray row, not a column, and is not dropped", () => {
    const items: MapItem[] = [
      item({ id: "inc-client", kind: "income", column: "client", name: "Alex salary", value: 90000 }),
      item({
        id: "inc-tray",
        kind: "income",
        column: "tray",
        name: "S-Corp distribution",
        value: 120000,
        valueLabel: "$120,000",
        trayOwnerLabel: "Acme Consulting S-Corp",
      }),
    ];

    render(<CashFlowBoard {...baseProps({ items })} />);

    const tray = screen.getByTestId("band-income-tray");
    expect(within(tray).getByText("S-Corp distribution")).toBeInTheDocument();
    // The tray-owner label is the card's chip — must actually be displayed.
    expect(within(tray).getByText("Acme Consulting S-Corp")).toBeInTheDocument();

    // Must not have leaked into any owner column.
    expect(
      within(screen.getByTestId("band-income-column-client")).queryByText("S-Corp distribution"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("band-income-column-joint")).queryByText("S-Corp distribution"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("band-income-column-spouse")).queryByText("S-Corp distribution"),
    ).not.toBeInTheDocument();

    // And it must count in the Income band's subtotal (90,000 + 120,000).
    expect(subtotalTextFor(document.body, "income")).toBe("Income · $210,000");
  });

  it("an entity-owned expense flow renders in the Expenses band's tray row, not a column, and is not dropped", () => {
    const items: MapItem[] = [
      item({ id: "exp-joint", kind: "expense", column: "joint", name: "Household rent", value: -24000 }),
      item({
        id: "exp-tray",
        kind: "expense",
        column: "tray",
        name: "S-Corp office lease",
        value: -18000,
        valueLabel: "($18,000)",
        trayOwnerLabel: "Acme Consulting S-Corp",
      }),
    ];

    render(<CashFlowBoard {...baseProps({ items })} />);

    const tray = screen.getByTestId("band-expense-tray");
    expect(within(tray).getByText("S-Corp office lease")).toBeInTheDocument();
    expect(within(tray).getByText("Acme Consulting S-Corp")).toBeInTheDocument();

    expect(
      within(screen.getByTestId("band-expense-column-client")).queryByText("S-Corp office lease"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("band-expense-column-joint")).queryByText("S-Corp office lease"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("band-expense-column-spouse")).queryByText("S-Corp office lease"),
    ).not.toBeInTheDocument();
  });

  it("Savings band subtotal is arithmetically correct with signed values, including an unresolvable rule (value 0)", () => {
    const items: MapItem[] = [
      // Flat-dollar 401k contribution — outflow, negative.
      item({
        id: "sav-flat",
        kind: "savings",
        column: "client",
        name: "401k contribution",
        value: -12000,
        valueLabel: "($12,000)",
      }),
      // Percent-of-pay rule — unresolvable without the projection: value 0,
      // the rule shown in valueLabel instead.
      item({
        id: "sav-pct",
        kind: "savings",
        column: "joint",
        name: "Roth IRA",
        value: 0,
        valueLabel: "20% of pay",
      }),
      // Entity-funded contribution, routed to the tray — must still count.
      item({
        id: "sav-tray",
        kind: "savings",
        column: "tray",
        name: "SEP-IRA contribution",
        value: -3000,
        valueLabel: "($3,000)",
        trayOwnerLabel: "Acme Consulting S-Corp",
      }),
    ];

    const { container } = render(<CashFlowBoard {...baseProps({ items })} />);

    // -12,000 + 0 + -3,000 = -15,000 → "($15,000)" via moneyLabel, not
    // formatCurrency (which would render a bare negative, not parens).
    expect(subtotalTextFor(container, "savings")).toBe("Savings · ($15,000)");
  });

  it("an empty owner column in a band renders the dashed add placeholder", () => {
    const items: MapItem[] = [
      item({ id: "inc-client", kind: "income", column: "client", name: "Alex salary", value: 90000 }),
      item({ id: "inc-joint", kind: "income", column: "joint", name: "Rental income", value: 18000 }),
      // No income item in the spouse column — it's empty.
    ];

    render(<CashFlowBoard {...baseProps({ items, canEdit: true })} />);

    const spouseCol = screen.getByTestId("band-income-column-spouse");
    expect(within(spouseCol).getByRole("button", { name: "+ add" })).toBeInTheDocument();

    // Non-empty columns must NOT show the placeholder.
    expect(
      within(screen.getByTestId("band-income-column-client")).queryByRole("button", { name: "+ add" }),
    ).not.toBeInTheDocument();
  });

  it("single-client household renders two owner columns (client, joint), not three", () => {
    const items: MapItem[] = [
      item({ id: "inc-client", kind: "income", column: "client", name: "Alex salary", value: 90000 }),
    ];

    render(
      <CashFlowBoard
        {...baseProps({
          people: { client: person({ firstName: "Alex" }), spouse: null, children: [] },
          items,
        })}
      />,
    );

    expect(screen.getByTestId("band-income-column-client")).toBeInTheDocument();
    expect(screen.getByTestId("band-income-column-joint")).toBeInTheDocument();
    expect(screen.queryByTestId("band-income-column-spouse")).not.toBeInTheDocument();
    expect(screen.queryByText("Jordan")).not.toBeInTheDocument();
  });

  // `canEdit` is a permission; `isItemEditable` is per-row writability. A row
  // the caller can't write (a synthesized life-insurance premium) must LOOK
  // inert, not merely behave inertly once clicked — so the board must not
  // render it as a button at all.
  it("honours isItemEditable per card: a non-editable row renders plain, its editable sibling stays a button", () => {
    const items: MapItem[] = [
      item({ id: "exp-real", kind: "expense", column: "joint", name: "Mortgage payment", value: -24000 }),
      item({
        id: "premium-abc",
        kind: "expense",
        column: "joint",
        category: "insurance",
        name: "Term policy premium",
        value: -1200,
      }),
    ];
    const onEditItem = vi.fn();

    const { container } = render(
      <CashFlowBoard
        {...baseProps({ items, canEdit: true })}
        onEditItem={onEditItem}
        isItemEditable={(i) => !i.id.startsWith("premium-")}
      />,
    );

    expect(screen.getByRole("button", { name: /Mortgage payment/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Term policy premium/ })).not.toBeInTheDocument();

    screen.getByText("Term policy premium").click();
    expect(onEditItem).not.toHaveBeenCalled();

    // The inert card is still in the DOM and still in the band subtotal.
    expect(subtotalTextFor(container, "expense")).toBe("Expenses \u00b7 ($25,200)");
  });

  it("with no isItemEditable supplied every card stays clickable — boards render standalone", () => {
    const items: MapItem[] = [
      item({ id: "exp-real", kind: "expense", column: "joint", name: "Mortgage payment", value: -24000 }),
    ];

    render(<CashFlowBoard {...baseProps({ items, canEdit: true })} onEditItem={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Mortgage payment/ })).toBeInTheDocument();
  });
});
