// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NetWorthBoard from "../net-worth-board";
import { categoryDefaultRates as buildCategoryDefaultRates } from "@/lib/investments/category-default-rates";
import type { HouseholdMapProps, MapItem, MapPerson } from "@/lib/household-map/types";
import { TEST_CLIENT_INFO, TEST_PLAN_SETTINGS } from "./fixtures";
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
    timing: null,
    editableAmount: null,
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
    ssIncomeRows: {},
    expenseRows: {},
    savingsRuleRows: {},
    savingsSchedules: {},
    flowScenarioFields: {},
    ssScenarioFields: {},
    clientScenarioFields: {},
    planSettingsScenarioFields: {},
    clientInfo: TEST_CLIENT_INFO,
    planSettings: TEST_PLAN_SETTINGS,
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
    // The real fallback map (all ten categories) rather than a hand-rolled
    // literal — `CategoryDefaultRateMap` requires every key, and calling the
    // shipped function keeps the fixture honest if those defaults ever move.
    categoryDefaultRates: buildCategoryDefaultRates(undefined, [], 0),
    assetClassOptions: [],
    portfolioAllocationsMap: {},
    categoryDefaultSources: {},
    businessOptions: [],
    rothIraAccountOptions: [],
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
    expect(within(spouseColumn).getByRole("button", { name: "Add account" })).toBeInTheDocument();
    expect(subtotalTextFor(container, "spouse")).toBe("Jordan · $0");
  });

  // POSITION, asserted on its own. The whole point of this change is WHERE the
  // add control sits — at the bottom of a long column it scrolled out of sight —
  // and an "it renders" assertion passes just as happily with the button back
  // under the last card. `compareDocumentPosition` is the only thing here that
  // can tell the two apart.
  it("the add control precedes the column's cards in DOM order, not follows them", () => {
    const items: MapItem[] = [
      item({ id: "a1", column: "client", kind: "account", name: "Brokerage account" }),
      item({ id: "a2", column: "client", kind: "account", name: "Roth IRA" }),
    ];

    render(<NetWorthBoard {...baseProps({ items, canEdit: true })} />);

    const clientColumn = screen.getByTestId("column-client");
    const addButton = within(clientColumn).getByRole("button", { name: "Add account" });
    const firstCard = within(clientColumn).getByText("Brokerage account");

    // Node.DOCUMENT_POSITION_FOLLOWING (4) — `firstCard` comes after `addButton`.
    expect(addButton.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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

describe("inline value editing", () => {
  it("saves a typed value through onSaveAccountField", async () => {
    const onSaveAccountField = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
        onSaveAccountField={onSaveAccountField}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Edit amount for IRA/ }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "500000{Enter}");

    expect(onSaveAccountField).toHaveBeenCalledWith("acct-1", { value: "500000" });
  });

  it("renders a plain value when canEdit is false", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: false,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
        onSaveAccountField={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Edit amount for IRA/ })).not.toBeInTheDocument();
  });

  it("renders a plain value when no save handler is wired", () => {
    // A board rendered without a writer must not offer an editable-looking
    // field that silently discards the edit.
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Edit amount for IRA/ })).not.toBeInTheDocument();
  });

  it("offers no editor on a liability card — liabilities have no hydrated row", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
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
        onSaveAccountField={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Edit amount for Mortgage/ })).not.toBeInTheDocument();
  });

  // Every Net Worth card is wrapped in a `<Link>`. `stopPropagation` alone
  // stops React handlers but NOT the browser's default action, so without a
  // `preventDefault` the first click on the amount navigates to the Net Worth
  // page instead of opening the editor. `fireEvent` returns false exactly when
  // the event was canceled, which is what makes this assertion falsifiable.
  it("does not let the click navigate the card's enclosing link", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
        onSaveAccountField={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Edit amount for IRA/ });
    expect(trigger.closest("a")).not.toBeNull();
    expect(fireEvent.click(trigger)).toBe(false);
  });
});

describe("edit pencil", () => {
  it("calls onEditAccount when the pencil is clicked", async () => {
    const onEditAccount = vi.fn();
    const user = userEvent.setup();
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
        onEditAccount={onEditAccount}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Edit IRA/ }));
    expect(onEditAccount).toHaveBeenCalledWith("acct-1");
  });

  it("renders no pencil for a liability", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
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
        onEditAccount={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Edit Mortgage/ })).not.toBeInTheDocument();
  });

  it("no longer wraps an editable account card in a navigating link", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
        onEditAccount={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link", { name: /IRA/ })).not.toBeInTheDocument();
  });

  // The plan said to drop the <Link> from every card. Liabilities and
  // synthesized policy rows get no pencil (they have no hydrated row), so doing
  // that would leave them completely inert — no editor AND no navigation. They
  // keep the link.
  it("KEEPS the link on cards that get no pencil", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
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
        onEditAccount={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /Mortgage/ })).toHaveAttribute(
      "href",
      "/clients/client-1/details/net-worth",
    );
  });

  it("keeps the link on an account card when the board cannot edit", () => {
    // No pencil to fall back on, so navigation has to survive.
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: false,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
        onEditAccount={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /IRA/ })).toBeInTheDocument();
  });
});

describe("card name opens the editor", () => {
  it("calls onEditAccount when the account name is clicked", async () => {
    const onEditAccount = vi.fn();
    const user = userEvent.setup();
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
          items: [item({ id: "acct-1", column: "client", name: "IRA", kind: "account" })],
          accountRows: { "acct-1": accountRow({ id: "acct-1" }) },
        })}
        onEditAccount={onEditAccount}
      />,
    );

    await user.click(screen.getByRole("button", { name: "IRA" }));
    expect(onEditAccount).toHaveBeenCalledWith("acct-1");
  });

  // A <button> may not nest inside an <a>. The cards that keep their link are
  // exactly the ones that get no pencil, so the name has to stay a plain span
  // there or the markup goes invalid and the click fights the navigation.
  it("leaves the name a plain span on a card that keeps its link", () => {
    render(
      <NetWorthBoard
        {...baseProps({
          canEdit: true,
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
        onEditAccount={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Mortgage" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mortgage/ })).toBeInTheDocument();
  });
});
