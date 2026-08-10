// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CashFlowBoard from "../cash-flow-board";
import { categoryDefaultRates as buildCategoryDefaultRates } from "@/lib/investments/category-default-rates";
import type {
  FlowTiming,
  HouseholdMapProps,
  MapItem,
  MapPerson,
} from "@/lib/household-map/types";
import { TEST_CLIENT_INFO, TEST_PLAN_SETTINGS } from "./fixtures";

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
    // Both default to "nothing to show / nothing to edit" so a case that cares
    // about the timing cell or the inline editor has to opt in explicitly.
    timing: null,
    editableAmount: null,
    ...overrides,
  };
}

function timing(overrides: Partial<FlowTiming> = {}): FlowTiming {
  return {
    startYear: 2026,
    endYear: 2060,
    startYearRef: null,
    endYearRef: null,
    startsAt: null,
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

  // The regression the band button exists to fix. The per-column placeholders
  // above render ONLY in an empty cell, so a band whose every column already had
  // a row offered no way to add another one — the affordance vanished exactly
  // when the advisor started using the board. Every column here is populated, so
  // this case is red without the band button.
  it("each band offers an add button beside its type label even when no column is empty", () => {
    const items: MapItem[] = [
      item({ id: "inc-client", kind: "income", column: "client", name: "Alex salary", value: 90000 }),
      item({ id: "inc-joint", kind: "income", column: "joint", name: "Rental income", value: 18000 }),
      item({ id: "inc-spouse", kind: "income", column: "spouse", name: "Jordan salary", value: 70000 }),
    ];

    render(<CashFlowBoard {...baseProps({ items, canEdit: true })} />);

    // No placeholder anywhere in the band — every column is populated.
    expect(
      within(screen.getByTestId("band-income")).queryByRole("button", { name: "+ add" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add income" })).toBeInTheDocument();
  });

  it("all three bands carry their own add button, each naming its own kind", () => {
    render(<CashFlowBoard {...baseProps({ canEdit: true })} />);

    expect(screen.getByRole("button", { name: "Add income" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add savings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeInTheDocument();
  });

  it("a band's add button reports its own kind and presets the joint column", () => {
    const onAddFlow = vi.fn();
    render(<CashFlowBoard {...baseProps({ canEdit: true })} onAddFlow={onAddFlow} />);

    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));

    // "joint", not a column: the gutter the button sits in spans all three.
    expect(onAddFlow).toHaveBeenCalledWith("expense", "joint");
  });

  it("a read-only viewer gets no band add buttons", () => {
    render(<CashFlowBoard {...baseProps({ canEdit: false })} />);

    expect(screen.queryByRole("button", { name: "Add income" })).not.toBeInTheDocument();
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

  // ── Timing column ──────────────────────────────────────────────────────────

  describe("timing column", () => {
    it("renders the row's start-end year range", () => {
      const items: MapItem[] = [
        item({
          id: "inc-1",
          kind: "income",
          column: "client",
          name: "Alex salary",
          value: 90000,
          timing: timing({ startYear: 2026, endYear: 2035 }),
        }),
      ];

      render(<CashFlowBoard {...baseProps({ items })} />);

      expect(screen.getByText("2026-2035")).toBeInTheDocument();
    });

    it("collapses a one-year window to a single year, not '2030-2030'", () => {
      const items: MapItem[] = [
        item({
          id: "exp-1",
          kind: "expense",
          column: "joint",
          name: "Roof replacement",
          value: -30000,
          timing: timing({ startYear: 2030, endYear: 2030 }),
        }),
      ];

      render(<CashFlowBoard {...baseProps({ items })} />);

      expect(screen.getByText("2030")).toBeInTheDocument();
      expect(screen.queryByText("2030-2030")).not.toBeInTheDocument();
    });

    // "2035" and "the year Cooper retires" are the same number until retirement
    // age moves, and only one of them follows it — so the anchor has to be
    // reachable, even if only on hover.
    it("names the milestone anchor in the cell's tooltip when the row has one", () => {
      const items: MapItem[] = [
        item({
          id: "exp-1",
          kind: "expense",
          column: "joint",
          name: "Retirement Living Expenses",
          value: -200000,
          timing: timing({
            startYear: 2035,
            endYear: 2060,
            startYearRef: "client_retirement",
            endYearRef: "plan_end",
          }),
        }),
      ];

      render(<CashFlowBoard {...baseProps({ items })} />);

      expect(screen.getByText("2035-2060")).toHaveAttribute(
        "title",
        "Starts Client Retirement (2035) · Ends Plan End (2060)",
      );
    });

    it("falls back to the bare years when a ref token is not a known anchor", () => {
      const items: MapItem[] = [
        item({
          id: "exp-1",
          kind: "expense",
          column: "joint",
          name: "Something",
          value: -1000,
          timing: timing({ startYearRef: "not_a_milestone" }),
        }),
      ];

      render(<CashFlowBoard {...baseProps({ items })} />);

      expect(screen.getByText("2026-2060")).toHaveAttribute(
        "title",
        "Starts 2026 · Ends 2060",
      );
    });

    it("renders no timing cell for a row with no window", () => {
      const items: MapItem[] = [
        item({ id: "inc-1", kind: "income", column: "client", name: "Alex salary", value: 90000 }),
      ];

      const { container } = render(<CashFlowBoard {...baseProps({ items })} />);

      expect(container.querySelector("[title^='Starts']")).toBeNull();
    });

    // ── startsAt: a row whose year range would misdescribe it ────────────────
    //
    // A Social Security row's persisted window is inert — the engine pays from
    // the CLAIM AGE — so "2024-2099" named neither the year the money starts nor
    // anything an advisor chose. `startsAt` replaces it. The label and the title
    // are asserted in SEPARATE cases on purpose: two expects in one `it` stop at
    // the first failure, so a title left showing the inert years would hide
    // behind a passing label assertion and never be exercised at all.
    const SS_TIMING = timing({
      startYear: 2024,
      endYear: 2099,
      startsAt: { label: "at 70", title: "Benefit starts at age 70 (2040)" },
    });

    function ssItem(): MapItem {
      return item({
        id: "inc-ss",
        kind: "income",
        column: "client",
        name: "Alex Social Security",
        value: 0,
        timing: SS_TIMING,
      });
    }

    it("renders the note's label in the cell", () => {
      render(<CashFlowBoard {...baseProps({ items: [ssItem()] })} />);

      expect(screen.getByText("at 70")).toBeInTheDocument();
    });

    // Its own case, not a second line under the one above: a cell that rendered
    // the note ALONGSIDE the range would satisfy that assertion and this is the
    // only thing that would catch it — and once the first assertion throws, a
    // second one in the same `it` never runs at all.
    it("leaves the inert year range nowhere in the cell", () => {
      render(<CashFlowBoard {...baseProps({ items: [ssItem()] })} />);

      expect(screen.queryByText("2024-2099")).not.toBeInTheDocument();
    });

    it("puts the note's sentence in the cell's tooltip", () => {
      render(<CashFlowBoard {...baseProps({ items: [ssItem()] })} />);

      expect(screen.getByText("at 70")).toHaveAttribute(
        "title",
        "Benefit starts at age 70 (2040)",
      );
    });

    // The failure mode the note exists to prevent, stated on its own: a fix that
    // changed only `timingLabel` would put "at 70" in the cell and leave
    // "Starts 2024 · Ends 2099" on its tooltip, handing the advisor back the
    // exact years the note replaced, one hover later.
    it("leaves no 'Starts … Ends …' tooltip anywhere on the card", () => {
      const { container } = render(<CashFlowBoard {...baseProps({ items: [ssItem()] })} />);

      expect(container.querySelector("[title^='Starts']")).toBeNull();
    });

    // The control for the two above. Same board, same cell, `startsAt: null` —
    // so neither case can be passing on a cell that ignores the year range
    // outright.
    it("still renders the year range when the row carries no note", () => {
      const items: MapItem[] = [
        item({
          id: "inc-ss",
          kind: "income",
          column: "client",
          name: "Alex Social Security",
          value: 0,
          timing: timing({ startYear: 2024, endYear: 2099, startsAt: null }),
        }),
      ];

      render(<CashFlowBoard {...baseProps({ items })} />);

      expect(screen.getByText("2024-2099")).toHaveAttribute("title", "Starts 2024 · Ends 2099");
      expect(screen.queryByText("at 70")).not.toBeInTheDocument();
    });
  });

  // ── Inline amount editing ──────────────────────────────────────────────────

  describe("inline amount editing", () => {
    function editableIncome(overrides: Partial<MapItem> = {}): MapItem {
      return item({
        id: "inc-1",
        kind: "income",
        column: "client",
        name: "Alex salary",
        value: 250000,
        valueLabel: "$250,000",
        editableAmount: 250000,
        ...overrides,
      });
    }

    it("commits an income edit as the amount typed", async () => {
      const onSaveFlowAmount = vi.fn().mockResolvedValue(true);
      render(
        <CashFlowBoard
          {...baseProps({ items: [editableIncome()] })}
          onSaveFlowAmount={onSaveFlowAmount}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Edit amount for Alex salary" }));
      const input = screen.getByRole("textbox", { name: "Amount for Alex salary" });
      fireEvent.change(input, { target: { value: "275000" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(onSaveFlowAmount).toHaveBeenCalledTimes(1));
      expect(onSaveFlowAmount.mock.calls[0][0].id).toBe("inc-1");
      expect(onSaveFlowAmount.mock.calls[0][1]).toBe(275000);
    });

    // DISCRIMINATING: `MapItem.value` is NEGATIVE for an outflow so band subtotals
    // net out, but the persisted `annualAmount` column is unsigned. Handing the
    // editor `value` would show "-$200,000" and write -200000 back, flipping the
    // expense into income for the whole projection.
    it("an expense edits its UNSIGNED amount while still displaying accounting parens", async () => {
      const onSaveFlowAmount = vi.fn().mockResolvedValue(true);
      const items: MapItem[] = [
        item({
          id: "exp-1",
          kind: "expense",
          column: "joint",
          name: "Current Living Expenses",
          value: -200000,
          valueLabel: "($200,000)",
          editableAmount: 200000,
        }),
      ];
      render(
        <CashFlowBoard {...baseProps({ items })} onSaveFlowAmount={onSaveFlowAmount} />,
      );

      // Read mode keeps the parens the read-only label had.
      const trigger = screen.getByRole("button", {
        name: "Edit amount for Current Living Expenses",
      });
      expect(trigger).toHaveTextContent("($200,000)");

      // Edit mode holds the unsigned figure.
      fireEvent.click(trigger);
      const input = screen.getByRole("textbox", { name: "Amount for Current Living Expenses" });
      expect(input).toHaveValue("200,000");

      fireEvent.change(input, { target: { value: "180000" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(onSaveFlowAmount).toHaveBeenCalledTimes(1));
      expect(onSaveFlowAmount.mock.calls[0][1]).toBe(180000);
    });

    // A percent-of-pay / IRS-max / custom-schedule rule resolves in the
    // projection, not here. Offering a number field would let an advisor type a
    // figure the engine then overrules.
    it("a savings rule with no resolvable dollar figure keeps its rule label and gets no editor", () => {
      const items: MapItem[] = [
        item({
          id: "sav-1",
          kind: "savings",
          column: "spouse",
          name: "Susan - 401k",
          value: 0,
          valueLabel: "10% of pay",
          editableAmount: null,
        }),
      ];

      render(
        <CashFlowBoard {...baseProps({ items })} onSaveFlowAmount={vi.fn()} />,
      );

      expect(screen.getByText("10% of pay")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Edit amount for Susan - 401k/ }),
      ).not.toBeInTheDocument();
    });

    // An editable-looking field with nowhere to write is worse than a read-only
    // one — the board is rendered standalone (no writer) in tests and by any
    // future read-only surface.
    it("renders the plain label when no writer is supplied", () => {
      render(<CashFlowBoard {...baseProps({ items: [editableIncome()] })} />);

      // Scoped to the card's column — the band subtotal renders the same figure.
      const col = screen.getByTestId("band-income-column-client");
      expect(within(col).getByText("$250,000")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Edit amount for Alex salary/ }),
      ).not.toBeInTheDocument();
    });

    it("a non-writable row gets neither the inline editor nor the pencil", () => {
      const items: MapItem[] = [
        item({
          id: "premium-abc",
          kind: "expense",
          column: "joint",
          category: "insurance",
          name: "Term policy premium",
          value: -1200,
          valueLabel: "($1,200)",
          editableAmount: 1200,
        }),
      ];

      render(
        <CashFlowBoard
          {...baseProps({ items })}
          onEditItem={vi.fn()}
          onSaveFlowAmount={vi.fn()}
          isItemEditable={(i) => !i.id.startsWith("premium-")}
        />,
      );

      const col = screen.getByTestId("band-expense-column-joint");
      expect(within(col).getByText("($1,200)")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Term policy premium/ })).not.toBeInTheDocument();
    });

    it("canEdit false suppresses the editor even with a writer wired up", () => {
      render(
        <CashFlowBoard
          {...baseProps({ items: [editableIncome()], canEdit: false })}
          onSaveFlowAmount={vi.fn()}
        />,
      );

      expect(
        screen.queryByRole("button", { name: /Edit amount for Alex salary/ }),
      ).not.toBeInTheDocument();
    });
  });

  // The tray used to be a `flex-col` of full-bleed rows, which read as more
  // important than the owner columns above it. Same three-up grid the Net Worth
  // board's tray uses.
  it("tray cards are laid out three-up, not stretched across the board", () => {
    const items: MapItem[] = [
      item({
        id: "inc-tray",
        kind: "income",
        column: "tray",
        name: "S-Corp distribution",
        value: 120000,
        trayOwnerLabel: "Acme Consulting S-Corp",
      }),
    ];

    render(<CashFlowBoard {...baseProps({ items })} />);

    const tray = screen.getByTestId("band-income-tray");
    const grid = tray.querySelector(".grid");
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass("grid-cols-3");
    // The card is inside that grid, not a sibling of it.
    expect(within(grid as HTMLElement).getByText("S-Corp distribution")).toBeInTheDocument();
  });
});
