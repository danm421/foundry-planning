// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SolverMonthlyCashFlowPanel, selectMonthlyRow } from "../solver-monthly-cash-flow-panel";
import type { MonthlyCashFlowRow } from "@/lib/solver/monthly-cash-flow";
import type { MonthRow } from "@/lib/solver/monthly-allocation";

function row(over: Partial<MonthlyCashFlowRow> = {}): MonthlyCashFlowRow {
  return {
    year: 2026,
    ageLabel: "Age 56 / 54",
    income: 10_000,
    fixed: {
      taxes: 2_000,
      liabilities: 1_500,
      savings: 1_000,
      insurance: 250,
      realEstate: 250,
      other: 0,
      total: 5_000,
    },
    leftAfterFixed: 5_000,
    portfolioDraw: 0,
    available: 5_000,
    split: { living: 5_000, surplusSpent: 0, surplusUnspent: 0, unexplained: 0 },
    depleted: false,
    ...over,
  };
}

const noop = () => {};

/** The table row for a year, found by its own year button rather than by
 *  position — a reordered table should not silently retarget an assertion. */
function rowFor(year: number): HTMLElement {
  const tr = screen
    .getAllByRole("row")
    .find((el) => within(el).queryByRole("button", { name: String(year) }) !== null);
  if (!tr) throw new Error(`no table row for ${year}`);
  return tr;
}

/** The cell under a named column header. Resolved through the header text, so
 *  the assertion follows the column if it moves instead of reading its
 *  neighbour. */
function cell(year: number, header: string): HTMLElement {
  const idx = screen
    .getAllByRole("columnheader")
    .findIndex((th) => th.textContent?.trim() === header);
  if (idx < 0) throw new Error(`no column headed "${header}"`);
  return within(rowFor(year)).getAllByRole("cell")[idx];
}

describe("SolverMonthlyCashFlowPanel", () => {
  it("shows the selected year's available figure as the headline", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[row(), row({ year: 2027, available: 6_100 })]}
        selectedYear={2027}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.getByTestId("monthly-available")).toHaveTextContent("$6,100");
    // Both conditional notes stay off a healthy year — a note rendered
    // unconditionally reads as true of every year in the plan.
    expect(screen.queryByText(/the portfolio supplies the rest/i)).toBeNull();
  });

  it("always labels the portfolio draw as its own line, never folded into income", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[row({ portfolioDraw: 3_000, available: 8_000 })]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    // Scoped to the hero line, not the whole panel: the table now carries a
    // "Portfolio draw" column header too, and an unscoped text match would be
    // satisfied by the header alone. Reading the label and the amount off the
    // SAME row is also the stronger claim — it is what "its own line" means.
    const drawLine = screen.getByTestId("monthly-draw").parentElement!;
    expect(drawLine).toHaveTextContent(/portfolio draw/i);
    expect(drawLine).toHaveTextContent("$3,000");
  });

  it("reads a negative left-after-fixed as a description, not an error", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[
          row({ income: 4_100, leftAfterFixed: -1_500, portfolioDraw: 6_500, available: 5_000 }),
        ]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.getByTestId("monthly-left-after-fixed")).toHaveTextContent("-$1,500");
    expect(screen.getByText(/the portfolio supplies the rest/i)).toBeInTheDocument();
  });

  // The engine does not always fund a shortfall by withdrawing: once the
  // accounts are empty it overdrafts checking and books no draw at all. Saying
  // "the portfolio supplies the rest" there describes a rescue that did not
  // happen.
  it("does not claim the portfolio covered a gap it never drew for", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[
          row({ income: 4_100, leftAfterFixed: -1_500, portfolioDraw: 0, available: -1_500 }),
        ]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.getByTestId("monthly-left-after-fixed")).toHaveTextContent("-$1,500");
    expect(screen.queryByText(/the portfolio supplies the rest/i)).toBeNull();
  });

  it("flags a depleted year on the hero card", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[row({ depleted: true })]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.getByText(/accounts are exhausted/i)).toBeInTheDocument();
  });

  // The hero card shows one year; the table shows all of them. A reader
  // scanning the table has to see which years the flag applies to without
  // clicking each one, so the row marker is its own carrier — and the selected
  // year here is the HEALTHY one, so the hero card cannot supply the match.
  it("flags the depleted year on its table row, and only that row", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[row(), row({ year: 2027, depleted: true })]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(within(rowFor(2027)).getByLabelText(/accounts exhausted/i)).toBeInTheDocument();
    expect(within(rowFor(2026)).queryByLabelText(/accounts exhausted/i)).toBeNull();
    expect(screen.queryByText(/accounts are exhausted/i)).toBeNull();
  });

  // The panel's only arithmetic. Three distinct non-zero parts, so dropping
  // any one of them — or reading the neighbouring column — changes the figure.
  it("adds insurance, real estate and other into one Other column", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[
          row({
            fixed: {
              taxes: 2_000,
              liabilities: 1_500,
              savings: 1_000,
              insurance: 100,
              realEstate: 20,
              other: 3,
              total: 4_623,
            },
          }),
        ]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(cell(2026, "Other")).toHaveTextContent("$123");
    expect(cell(2026, "Savings")).toHaveTextContent("$1,000");
    expect(cell(2026, "Available")).toHaveTextContent("$5,000");
  });

  it("shows the portfolio draw as its own column, so every row reconciles", () => {
    // The browser pass found that without this column `Available` cannot be
    // derived from what is on screen: on a drawing plan it exceeds income minus
    // the four cost columns by exactly the draw, and every row of the table
    // reads as an arithmetic error.
    render(
      <SolverMonthlyCashFlowPanel
        rows={[
          row({
            income: 10_000,
            fixed: {
              taxes: 2_000,
              liabilities: 1_500,
              savings: 1_000,
              insurance: 100,
              realEstate: 20,
              other: 3,
              total: 4_623,
            },
            leftAfterFixed: 5_377,
            portfolioDraw: 1_234,
            available: 6_611,
          }),
        ]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );

    expect(cell(2026, "Portfolio draw")).toHaveTextContent("$1,234");

    // The reading, not just the presence: the money-in columns come first, the
    // costs after, the result last. That order is why the column needs no
    // "this one is added, not subtracted" note beside it.
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent?.trim())).toEqual([
      "Year",
      "Age",
      "Income",
      "Portfolio draw",
      "Taxes",
      "Debt",
      "Savings",
      "Other",
      "Available",
    ]);

    // And the row actually adds up as rendered — read back off the screen, not
    // recomputed from the fixture.
    const money = (header: string) => Number(cell(2026, header).textContent!.replace(/[$,]/g, ""));
    expect(
      money("Income") +
        money("Portfolio draw") -
        money("Taxes") -
        money("Debt") -
        money("Savings") -
        money("Other"),
    ).toBe(money("Available"));
  });

  it("moves the headline when a table row is clicked", async () => {
    const onYearClick = vi.fn();
    render(
      <SolverMonthlyCashFlowPanel
        rows={[row(), row({ year: 2027, available: 6_100 })]}
        selectedYear={2026}
        onYearClick={onYearClick}
        basis="today"
        onBasisChange={noop}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "2027" }));
    expect(onYearClick).toHaveBeenCalledWith(2027);
  });

  it("opens on the first year income stops covering fixed costs", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[row(), row({ year: 2027, income: 3_000, leftAfterFixed: -2_000, available: 4_444 })]}
        selectedYear={null}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.getByTestId("monthly-available")).toHaveTextContent("$4,444");
  });

  it("offers a dollar-basis toggle that shows which basis is live", async () => {
    const onBasisChange = vi.fn();
    render(
      <SolverMonthlyCashFlowPanel
        rows={[row()]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={onBasisChange}
      />,
    );
    expect(screen.getByRole("button", { name: /today's dollars/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /future dollars/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: /future dollars/i }));
    expect(onBasisChange).toHaveBeenCalledWith("nominal");
  });

  // A leftover the parts cannot account for is shown, never folded away. Below
  // a dollar a month it is float dust that would render as "$0", so it stays
  // hidden — both halves asserted, because a row that is always there and a row
  // that is never there each pass a one-sided check.
  it("shows an unaccounted-for remainder only when there is one", () => {
    const { unmount } = render(
      <SolverMonthlyCashFlowPanel
        rows={[row()]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.queryByText(/unaccounted for/i)).toBeNull();
    unmount();

    render(
      <SolverMonthlyCashFlowPanel
        rows={[row({ split: { living: 4_750, surplusSpent: 0, surplusUnspent: 0, unexplained: 250 } })]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.getByTestId("monthly-unexplained")).toHaveTextContent("$250");
  });

  it("says so when there is nothing to show", () => {
    render(
      <SolverMonthlyCashFlowPanel
        rows={[]}
        selectedYear={2026}
        onYearClick={noop}
        basis="today"
        onBasisChange={noop}
      />,
    );
    expect(screen.getByText(/no projection years to show/i)).toBeInTheDocument();
  });
});

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Twelve rows the shape `buildMonthlyAllocation` returns. Defaults are a flat,
 *  healthy year; each test overrides only the field it is about. */
function monthRow(i: number, over: Partial<MonthRow> = {}): MonthRow {
  return {
    month: i + 1,
    label: MONTH_LABELS[i],
    income: 8_000,
    portfolioDraw: 1_000,
    taxes: 1_500,
    debt: 900,
    savings: 500,
    other: 400,
    living: 5_000,
    net: 700,
    cashOnHand: 10_000 + 700 * (i + 1),
    ...over,
  };
}

const twelveMonths = Array.from({ length: 12 }, (_, i) => monthRow(i));

/** For the month-view block only. The fourteen tests above inline their props
 *  and are deliberately left alone. */
const baseProps = {
  rows: [row()],
  selectedYear: 2026 as number | null,
  onYearClick: noop,
  basis: "today" as const,
  onBasisChange: noop,
};

describe("selectMonthlyRow", () => {
  // The rule this helper exists to make un-duplicable. The panel opens on the
  // first SHORTFALL year, not the first year — and the chart panel has to pick
  // the same one, or the table captions one year and lists another's months.
  const covered = row({ year: 2026, income: 10_000 });
  const short = row({ year: 2027, income: 4_000 });
  const alsoShort = row({ year: 2028, income: 3_000 });

  it("opens on the first shortfall year when no year is picked", () => {
    expect(selectMonthlyRow([covered, short, alsoShort], null)?.year).toBe(2027);
  });

  it("honours an explicitly picked year over the shortfall rule", () => {
    expect(selectMonthlyRow([covered, short, alsoShort], 2028)?.year).toBe(2028);
  });

  it("falls back to the first year when income never falls short", () => {
    expect(selectMonthlyRow([covered, row({ year: 2027, income: 9_000 })], null)?.year).toBe(2026);
  });

  it("returns undefined for an empty projection", () => {
    expect(selectMonthlyRow([], null)).toBeUndefined();
  });
});

describe("SolverMonthlyCashFlowPanel — month by month", () => {
  it("shows the year table in plan view and the month table in months view", () => {
    const { rerender } = render(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        monthRows={twelveMonths}
        view="plan"
        onViewChange={noop}
      />,
    );
    expect(screen.queryByText("January")).toBeNull();

    rerender(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        monthRows={twelveMonths}
        view="months"
        onViewChange={noop}
      />,
    );
    expect(screen.getByText("January")).toBeTruthy();
    expect(screen.getByText("December")).toBeTruthy();
  });

  it("renders twelve month rows with a Living column and a running balance", () => {
    render(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        monthRows={twelveMonths}
        view="months"
        onViewChange={noop}
      />,
    );
    expect(screen.getAllByTestId("month-row")).toHaveLength(12);
    expect(screen.getByText("Living")).toBeTruthy();
    expect(screen.getByText("Cash on hand")).toBeTruthy();
  });

  it("reports a view change from the toggle", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    render(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        monthRows={twelveMonths}
        view="plan"
        onViewChange={onViewChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Month by month" }));
    expect(onViewChange).toHaveBeenCalledWith("months");
  });

  // A mid-year-originated entity-owned mortgage really does produce negative
  // debt months (Task 6 built the fixture and proved it). The allocator is the
  // authority; the cell must show what it returned, minus sign and all. A clamp
  // here would turn a row that reconciles into one that silently does not.
  it("shows a negative debt month rather than clamping it to zero", () => {
    const withNegativeDebt = twelveMonths.map((m, i) => (i < 6 ? { ...m, debt: -1_200 } : m));
    render(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        monthRows={withNegativeDebt}
        view="months"
        onViewChange={noop}
      />,
    );
    expect(screen.getAllByTestId("month-row")[0]).toHaveTextContent("-$1,200");
  });

  // `cashOnHand` seeds from the portfolio-wide liquid set and then walks it with
  // checking-level flows — it adds the portfolio draw (money LEAVING those
  // accounts) and subtracts savings (money ENTERING them), and never adds
  // growth. In a drawdown year it runs high by roughly the year's whole draw, so
  // presenting it as a bank balance misstates the client's liquid position. The
  // note has to be VISIBLE; an sr-only caption is not a disclosure a sighted
  // advisor ever reads.
  it("captions the running balance as cash flow, never as a bank balance", () => {
    render(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        monthRows={twelveMonths}
        view="months"
        onViewChange={noop}
      />,
    );
    // `toBeVisible()` CANNOT see this on its own: jsdom does not compute
    // Tailwind's clip-based `sr-only`, so a note moved into an sr-only span
    // passes it (measured — the assertion below is what reds). The ruling is
    // that a SIGHTED advisor reads this, so the class is what has to be pinned.
    const note = screen.getByTestId("cash-on-hand-note");
    expect(note).toBeVisible();
    expect(note.className).not.toMatch(/\bsr-only\b/);
    expect(screen.queryByText(/cash left in the account/i)).toBeNull();
    expect(screen.queryByText(/bank balance/i)).toBeNull();
  });

  // `net` subtracts a surplusSpent term that has NO column, so in a year with
  // discretionary spend the visible columns genuinely do not add up to the row's
  // own net. A Task 6 test asserts that gap deliberately. Say so in the years it
  // applies to — and stay quiet in the ones it does not.
  it("explains the missing surplus term only in a year that has one", () => {
    const { unmount } = render(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        monthRows={twelveMonths}
        view="months"
        onViewChange={noop}
      />,
    );
    expect(screen.queryByTestId("surplus-spent-note")).toBeNull();
    unmount();

    render(
      <SolverMonthlyCashFlowPanel
        {...baseProps}
        rows={[
          row({ split: { living: 2_000, surplusSpent: 3_000, surplusUnspent: 0, unexplained: 0 } }),
        ]}
        monthRows={twelveMonths}
        view="months"
        onViewChange={noop}
      />,
    );
    // The figure is PER MONTH — `split.surplusSpent` is the year's discretionary
    // spend over twelve, and the allocator takes that same twelfth out of each
    // month's Net. A sentence that reads as the year's total understates by 12x,
    // so the framing is pinned alongside the amount.
    const surplus = screen.getByTestId("surplus-spent-note");
    expect(surplus).toHaveTextContent(/surplus/i);
    expect(surplus).toHaveTextContent("$3,000");
    expect(surplus).toHaveTextContent(/each month/i);
  });
});

// The unit tests above pin the RULE; this pins that there is only ONE
// implementation of it. The plan shipped a second copy in the chart panel
// (`currentProjection.find(...) ?? currentProjection[0]`) with no shortfall
// clause, which disagrees with the panel whenever `selectedYear` is null — its
// value every time the Monthly sub-tab is opened. The table would then caption
// one year and list another's twelve months, silently. The behaviour is not
// renderable from here, so the guard is on the source.
describe("the chart panel resolves the month year through the shared helper", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/(app)/clients/[id]/solver/solver-chart-panel.tsx"),
    "utf8",
  );

  it("calls selectMonthlyRow", () => {
    expect(source).toContain("selectMonthlyRow(");
  });

  it("keeps no second year-selection rule of its own", () => {
    expect(source).not.toMatch(/currentProjection\s*\[\s*0\s*\]/);
  });
});
