// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SolverMonthlyCashFlowPanel } from "../solver-monthly-cash-flow-panel";
import type { MonthlyCashFlowRow } from "@/lib/solver/monthly-cash-flow";

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
    expect(screen.getByText(/portfolio draw/i)).toBeInTheDocument();
    expect(screen.getByTestId("monthly-draw")).toHaveTextContent("$3,000");
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
