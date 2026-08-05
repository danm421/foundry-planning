// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { withdrawalRow as row } from "@/lib/solver/__tests__/withdrawal-report-fixtures";

import { SolverWithdrawalPanel } from "../solver-withdrawal-panel";

function headers(): string[] {
  return screen
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.replace(/ⓘ/g, "").trim() ?? "");
}

describe("SolverWithdrawalPanel", () => {
  it("shows a column per drawn source and drops the sources never used", () => {
    render(
      <SolverWithdrawalPanel
        rows={[
          row({ year: 2026, withdrawals: { cash: 0, taxable: 5_000, preTax: 0, roth: 0 } }),
          row({ year: 2027, withdrawals: { cash: 0, taxable: 0, preTax: 7_000, roth: 0 } }),
        ]}
        selectedYear={null}
        onYearClick={vi.fn()}
      />,
    );

    const h = headers();
    expect(h).toContain("Taxable");
    expect(h).toContain("Tax-Deferred");
    expect(h).not.toContain("Cash");
    expect(h).not.toContain("Roth");
  });

  it("carries one income column — the engine's Total Income — and no per-source income breakdown", () => {
    render(
      <SolverWithdrawalPanel
        rows={[
          row({
            year: 2026,
            totalIncome: 120_000,
            withdrawals: { cash: 0, taxable: 5_000, preTax: 0, roth: 0 },
            withdrawalsTotal: 5_000,
            portfolioBoy: 1_000_000,
            withdrawalRate: 0.045,
          }),
        ]}
        selectedYear={null}
        onYearClick={vi.fn()}
      />,
    );

    // Exact order, so a column added in the wrong group fails here too.
    expect(headers()).toEqual([
      "Year",
      "Age",
      "Total Income",
      "Taxable",
      "Total Withdrawals",
      "Portfolio (BoY)",
      "Withdrawal %",
      "Living Expenses",
      "Total Expenses",
      "Net Cash Flow",
    ]);
  });

  it("shows the withdrawal rate as a percent, beside the portfolio it is measured against", () => {
    render(
      <SolverWithdrawalPanel
        rows={[
          row({
            year: 2031,
            withdrawalsTotal: 37_500,
            portfolioBoy: 1_000_000,
            withdrawalRate: 0.0375,
          }),
        ]}
        selectedYear={null}
        onYearClick={vi.fn()}
      />,
    );

    const cells = within(screen.getAllByRole("row")[1]);
    expect(cells.getByText("3.75%")).toBeTruthy();
    expect(cells.getByText("$1,000,000")).toBeTruthy();
  });

  it("still shows the rate and its denominator for a plan that never withdraws", () => {
    // 0% is a real answer, not an empty column — a plan funded entirely by
    // income should say so rather than drop the two columns that prove it.
    render(
      <SolverWithdrawalPanel rows={[row()]} selectedYear={null} onYearClick={vi.fn()} />,
    );

    // No draw anywhere, so `activeWithdrawalSources` contributes no per-source
    // column and the portfolio group opens at Total Withdrawals.
    expect(headers()).toEqual([
      "Year",
      "Age",
      "Total Income",
      "Total Withdrawals",
      "Portfolio (BoY)",
      "Withdrawal %",
      "Living Expenses",
      "Total Expenses",
      "Net Cash Flow",
    ]);
    expect(within(screen.getAllByRole("row")[1]).getByText("0.00%")).toBeTruthy();
  });

  it("renders each year's figures as currency and flags a negative Net Cash Flow", () => {
    render(
      <SolverWithdrawalPanel
        rows={[
          row({
            year: 2031,
            ages: { client: 70, spouse: 68 },
            livingExpenses: 80_000,
            totalExpenses: 110_000,
            totalIncome: 60_000,
            netCashFlow: -50_000,
            withdrawals: { cash: 0, taxable: 50_000, preTax: 0, roth: 0 },
            withdrawalsTotal: 50_000,
          }),
        ]}
        selectedYear={null}
        onYearClick={vi.fn()}
      />,
    );

    const cells = screen.getAllByRole("row")[1];
    expect(within(cells).getByText("2031")).toBeTruthy();
    expect(within(cells).getByText("70 / 68")).toBeTruthy();
    expect(within(cells).getByText("$80,000")).toBeTruthy();

    const net = within(cells).getByText("-$50,000");
    expect(net.className).toContain("text-crit");
  });

  it("selects a year when its Year cell is clicked", () => {
    const onYearClick = vi.fn();
    render(
      <SolverWithdrawalPanel
        rows={[row({ year: 2031 })]}
        selectedYear={null}
        onYearClick={onYearClick}
      />,
    );

    fireEvent.click(screen.getByText("2031"));
    expect(onYearClick).toHaveBeenCalledWith(2031);
  });

  it("highlights the row for the selected year", () => {
    render(
      <SolverWithdrawalPanel
        rows={[row({ year: 2031 }), row({ year: 2032 })]}
        selectedYear={2032}
        onYearClick={vi.fn()}
      />,
    );

    expect(screen.getByText("2032").className).toContain("accent-wash");
    expect(screen.getByText("2031").className).not.toContain("accent-wash");
  });

  it("keeps the selected row's sticky cells opaque so scrolled columns can't bleed through", () => {
    // accent-wash is translucent; on a `position: sticky` cell it has to ride on
    // top of the opaque card color, never replace it.
    render(
      <SolverWithdrawalPanel
        rows={[row({ year: 2031, netCashFlow: -1_000 })]}
        selectedYear={2031}
        onYearClick={vi.fn()}
      />,
    );

    const rowCells = within(screen.getAllByRole("row")[1]);
    for (const cell of [
      screen.getByText("2031"), // sticky left (Year)
      rowCells.getByText("-$1,000"), // sticky right (Net Cash Flow)
    ]) {
      expect(cell.className).toContain("sticky");
      expect(cell.className).toContain("bg-card");
    }
  });

  it("falls back to a message when the projection is empty", () => {
    render(<SolverWithdrawalPanel rows={[]} selectedYear={null} onYearClick={vi.fn()} />);
    expect(screen.getByText("No projection years to show.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
