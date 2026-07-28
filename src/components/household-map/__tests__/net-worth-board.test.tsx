// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import NetWorthBoard from "../net-worth-board";
import type { HouseholdMapProps, MapItem, MapPerson } from "@/lib/household-map/types";
import type { AccountRow } from "@/components/balance-sheet-view";

// `useScenarioPreservingHref` reads the URL's `?scenario=`. `vi.hoisted` so the
// hoisted `vi.mock` factory can close over a value the tests mutate per case
// (a bare `let` would be in its TDZ when the factory first runs).
const nav = vi.hoisted(() => ({ scenario: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === "scenario" ? nav.scenario : null),
    toString: () => (nav.scenario ? `scenario=${nav.scenario}` : ""),
  }),
  usePathname: () => "/clients/client-1/details/map",
}));

afterEach(() => {
  nav.scenario = null;
});

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

function item(overrides: Partial<MapItem> & Pick<MapItem, "id" | "column">): MapItem {
  return {
    kind: "account",
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
    accountRows: {},
    // Controller resolution R3: Task 5 adds ONLY `accountRows` and
    // `growthContext`. The plan's snippet also seeds `categoryDefaultRates: {}`
    // here, but that prop is not declared on `HouseholdMapProps` until Task 7 —
    // adding it now would be an excess property and would not compile.
    growthContext: {
      modelPortfolios: [],
      fundPortfolios: [],
      resolvedInflationRate: 0.025,
      categoryDefaults: {},
    },
    resolvedInflationRate: 0.03,
    familyMemberOptions: [],
    entityOptions: [],
    ...overrides,
  };
}

function accountRow(overrides: Partial<AccountRow> & { id: string }): AccountRow {
  return {
    name: "IRA",
    category: "retirement",
    subType: "traditional_ira",
    owner: "client",
    value: "400000",
    basis: "0",
    growthRate: "0.062",
    growthSource: "default",
    ...overrides,
  } as AccountRow;
}

/** The subtotal line is `{label} · <b>{moneyLabel(subtotal)}</b>` — the bold
 *  total is the only `<b>` this component renders, so its parent's full text
 *  content is the reliable way to assert a combined "label · $amount" string
 *  across the split text nodes. */
function subtotalTextFor(container: HTMLElement, col: string): string | null {
  const columnEl = container.querySelector(`[data-testid="column-${col}"]`);
  const bold = columnEl?.querySelector("b");
  return bold?.parentElement?.textContent ?? null;
}

describe("NetWorthBoard", () => {
  it("married household — renders three columns, a tray, and correct subtotals (including a mixed sign column)", () => {
    const items: MapItem[] = [
      // Client column: account + liability — pins the signed-value contract.
      item({ id: "a1", column: "client", kind: "account", value: 100000, valueLabel: "$100,000" }),
      item({
        id: "l1",
        column: "client",
        kind: "liability",
        category: "debt",
        value: -30000,
        valueLabel: "($30,000)",
      }),
      item({ id: "a2", column: "joint", value: 50000, valueLabel: "$50,000" }),
      item({
        id: "l2",
        column: "spouse",
        kind: "liability",
        category: "debt",
        value: -20000,
        valueLabel: "($20,000)",
      }),
      // Tray: entity-owned account, must not bleed into any column's subtotal.
      item({
        id: "t1",
        column: "tray",
        kind: "account",
        name: "Family LLC brokerage",
        value: 999999,
        valueLabel: "$999,999",
        trayOwnerLabel: "Family LLC",
      }),
    ];

    const { container } = render(<NetWorthBoard {...baseProps({ items })} />);

    expect(screen.getByTestId("column-client")).toBeInTheDocument();
    expect(screen.getByTestId("column-joint")).toBeInTheDocument();
    expect(screen.getByTestId("column-spouse")).toBeInTheDocument();

    // Signed-value arithmetic: 100,000 + (-30,000) = 70,000.
    expect(subtotalTextFor(container, "client")).toBe("Alex · $70,000");
    expect(subtotalTextFor(container, "joint")).toBe("Jointly Held · $50,000");
    expect(subtotalTextFor(container, "spouse")).toBe("Jordan · ($20,000)");

    // Tray renders, is labelled, and does not affect any column subtotal.
    const tray = screen.getByTestId("tray");
    expect(within(tray).getByText("Family LLC brokerage")).toBeInTheDocument();
    expect(within(tray).getByRole("link")).toHaveAttribute(
      "href",
      "/clients/client-1/details/net-worth",
    );
  });

  it("excludes flow-kind items (income/savings/expense) from both a real column's cards/subtotal and the tray", () => {
    const items: MapItem[] = [
      // Real client-column asset — the only thing that should count.
      item({ id: "a1", column: "client", kind: "account", value: 100000, valueLabel: "$100,000" }),
      // Flow-kind items wrongly assigned to a real column — a regression that
      // dropped the kind filter would render these cards AND inflate the
      // subtotal by their (oversized, deliberately-obvious) values.
      item({
        id: "leak-income",
        column: "client",
        kind: "income",
        name: "Leaked salary",
        value: 999000,
        valueLabel: "$999,000",
      }),
      item({
        id: "leak-savings",
        column: "client",
        kind: "savings",
        name: "Leaked 401k contribution",
        value: -888000,
        valueLabel: "$888,000",
      }),
      item({
        id: "leak-expense",
        column: "client",
        kind: "expense",
        name: "Leaked rent",
        value: -777000,
        valueLabel: "$777,000",
      }),
      // Legitimate tray item (entity-owned account) — must still render.
      item({
        id: "tray-real",
        column: "tray",
        kind: "account",
        name: "Family LLC brokerage",
        value: 50000,
        valueLabel: "$50,000",
        trayOwnerLabel: "Family LLC",
      }),
      // Flow-kind item wrongly assigned to the tray — must not render there.
      item({
        id: "leak-tray-income",
        column: "tray",
        kind: "income",
        name: "Leaked trust income",
        value: 12345,
        valueLabel: "$12,345",
        trayOwnerLabel: "Family Trust",
      }),
    ];

    const { container } = render(<NetWorthBoard {...baseProps({ items })} />);

    // Column: only the real account counts, both in the DOM and the subtotal.
    const clientColumn = screen.getByTestId("column-client");
    expect(within(clientColumn).queryByText("Leaked salary")).not.toBeInTheDocument();
    expect(within(clientColumn).queryByText("Leaked 401k contribution")).not.toBeInTheDocument();
    expect(within(clientColumn).queryByText("Leaked rent")).not.toBeInTheDocument();
    expect(subtotalTextFor(container, "client")).toBe("Alex · $100,000");

    // Tray: the real entity-owned account renders; the flow-kind item does not.
    const tray = screen.getByTestId("tray");
    expect(within(tray).getByText("Family LLC brokerage")).toBeInTheDocument();
    expect(within(tray).queryByText("Leaked trust income")).not.toBeInTheDocument();
    expect(within(tray).getAllByRole("link")).toHaveLength(1);
  });

  it("single client — one centred node, no bracket/'Jointly Held', two columns only", () => {
    const items: MapItem[] = [
      item({ id: "a1", column: "client", value: 100000, valueLabel: "$100,000" }),
    ];

    render(
      <NetWorthBoard
        {...baseProps({
          people: { client: person({ firstName: "Alex" }), spouse: null, children: [] },
          items,
        })}
      />,
    );

    expect(screen.queryByText("Jordan")).not.toBeInTheDocument();
    expect(screen.queryByText("Jointly Held")).not.toBeInTheDocument();

    expect(screen.getByTestId("column-client")).toBeInTheDocument();
    expect(screen.getByTestId("column-joint")).toBeInTheDocument();
    expect(screen.queryByTestId("column-spouse")).not.toBeInTheDocument();

    // The connector leg grid must have exactly two legs, not three.
    expect(screen.getByTestId("net-worth-legs").children).toHaveLength(2);
  });

  it("an empty column still renders its header, add control, and a $0 subtotal — the leg must not dangle", () => {
    const items: MapItem[] = [
      item({ id: "a1", column: "client", value: 100000, valueLabel: "$100,000" }),
      // No items in "spouse" — that column is empty.
    ];

    const { container } = render(<NetWorthBoard {...baseProps({ items, canEdit: true })} />);

    // Leg count is unaffected by an empty column — still three legs for three columns.
    expect(screen.getByTestId("net-worth-legs").children).toHaveLength(3);

    const spouseColumn = screen.getByTestId("column-spouse");
    expect(within(spouseColumn).getByText("Jordan")).toBeInTheDocument();
    expect(within(spouseColumn).getByRole("button", { name: "+ Add" })).toBeInTheDocument();
    expect(subtotalTextFor(container, "spouse")).toBe("Jordan · $0");
  });

  it("column account and liability cards are links to the Net Worth detail page", () => {
    const items: MapItem[] = [
      item({ id: "a1", column: "client", kind: "account", name: "Brokerage account" }),
      item({
        id: "l1",
        column: "client",
        kind: "liability",
        category: "debt",
        name: "Mortgage debt",
      }),
    ];

    render(<NetWorthBoard {...baseProps({ items })} />);

    const clientColumn = screen.getByTestId("column-client");
    const links = within(clientColumn).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/clients/client-1/details/net-worth");
    }
    expect(within(links[0]).getByText("Brokerage account")).toBeInTheDocument();
    expect(within(links[1]).getByText("Mortgage debt")).toBeInTheDocument();
  });

  it("card and tray links carry the active ?scenario= through — landing on the BASE balance sheet from a scenario-active Map is the bug this prevents", () => {
    nav.scenario = "sc-9";
    const items: MapItem[] = [
      item({ id: "a1", column: "client", kind: "account", name: "Brokerage account" }),
      item({
        id: "t1",
        column: "tray",
        kind: "account",
        name: "Family LLC brokerage",
        trayOwnerLabel: "Family LLC",
      }),
    ];

    render(<NetWorthBoard {...baseProps({ items })} />);

    expect(within(screen.getByTestId("column-client")).getByRole("link")).toHaveAttribute(
      "href",
      "/clients/client-1/details/net-worth?scenario=sc-9",
    );
    expect(within(screen.getByTestId("tray")).getByRole("link")).toHaveAttribute(
      "href",
      "/clients/client-1/details/net-worth?scenario=sc-9",
    );
  });

  it("no entity-owned items — the tray is absent entirely, not an empty labelled strip", () => {
    const items: MapItem[] = [
      item({ id: "a1", column: "client", value: 100000, valueLabel: "$100,000" }),
      item({ id: "a2", column: "joint", value: 50000, valueLabel: "$50,000" }),
      item({ id: "a3", column: "spouse", value: 75000, valueLabel: "$75,000" }),
    ];

    render(<NetWorthBoard {...baseProps({ items })} />);

    expect(screen.queryByTestId("tray")).not.toBeInTheDocument();
    expect(screen.queryByText(/Held by trusts/)).not.toBeInTheDocument();
  });
});

describe("growth rate display", () => {
  it("shows the resolved rate on an in-scope account card", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
      />,
    );
    expect(screen.getByText("6.20%")).toBeInTheDocument();
  });

  it("shows no rate for a liability card", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          items: [
            item({
              id: "liab-1",
              column: "joint",
              name: "Mortgage",
              kind: "liability",
              category: "debt",
            }),
          ],
          accountRows: {},
        })}
      />,
    );
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it("shows no rate for a life-insurance policy — policies are out of scope", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          items: [
            item({
              id: "acct-li",
              column: "client",
              name: "Whole Life",
              kind: "account",
              category: "insurance",
            }),
          ],
          accountRows: { "acct-li": accountRow({ id: "acct-li", category: "life_insurance" }) },
        })}
      />,
    );
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it("shows the rate on a tray card too", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          items: [
            item({
              id: "acct-tray",
              column: "tray",
              name: "Trust Brokerage",
              kind: "account",
              trayOwnerLabel: "Smith Family Trust",
            }),
          ],
          accountRows: { "acct-tray": accountRow({ id: "acct-tray", growthRate: "0.048" }) },
        })}
      />,
    );
    expect(screen.getByText("4.80%")).toBeInTheDocument();
  });
});
