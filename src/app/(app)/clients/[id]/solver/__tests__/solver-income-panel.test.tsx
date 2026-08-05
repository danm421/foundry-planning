// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { incomeRow as row } from "@/lib/solver/__tests__/income-report-fixtures";

import { SolverIncomePanel } from "../solver-income-panel";

function headers(): string[] {
  return screen
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.replace(/ⓘ/g, "").trim() ?? "");
}

describe("SolverIncomePanel", () => {
  it("shows a column per drawn source and drops the sources never used", () => {
    render(
      <SolverIncomePanel
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

  it("keeps the totals and Net Cash Flow even when every year reads zero", () => {
    render(
      <SolverIncomePanel rows={[row()]} selectedYear={null} onYearClick={vi.fn()} />,
    );

    const h = headers();
    expect(h).toEqual(
      expect.arrayContaining([
        "Total Income",
        "Total Withdrawals",
        "Living Expenses",
        "Total Expenses",
        "Net Cash Flow",
      ]),
    );
    // Social Security / Salaries / RMDs are all zero here, so they drop out.
    expect(h).not.toContain("Social Security");
  });

  it("renders each year's figures as currency and flags a negative Net Cash Flow", () => {
    render(
      <SolverIncomePanel
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
      <SolverIncomePanel
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
      <SolverIncomePanel
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
      <SolverIncomePanel
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
    render(<SolverIncomePanel rows={[]} selectedYear={null} onYearClick={vi.fn()} />);
    expect(screen.getByText("No projection years to show.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
