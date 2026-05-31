// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectionYear } from "@/engine/types";
import { TaxDetailIncomeTable, INCOME_COLUMNS } from "../tax-detail-income-table";

function makeYear(): ProjectionYear {
  return {
    year: 2030,
    ages: { client: 67 },
    taxResult: {
      income: {
        earnedIncome: 100_000, taxableSocialSecurity: 17_000, ordinaryIncome: 8_000,
        dividends: 3_000, capitalGains: 4_000, shortCapitalGains: 1_000,
        totalIncome: 133_000, nonTaxableIncome: 4_500, grossTotalIncome: 137_500,
      },
    },
  } as unknown as ProjectionYear;
}

describe("TaxDetailIncomeTable", () => {
  it("calls onYearClick when the year cell is clicked", async () => {
    const user = userEvent.setup();
    const onYearClick = vi.fn();
    const onCellClick = vi.fn();
    const year = makeYear();
    render(
      <TaxDetailIncomeTable
        years={[year]}
        onYearClick={onYearClick}
        onCellClick={onCellClick}
      />,
    );
    await user.click(screen.getByText("2030"));
    expect(onYearClick).toHaveBeenCalledWith(year);
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it("calls onCellClick(year, columnKey) when a category cell is clicked", async () => {
    const user = userEvent.setup();
    const onYearClick = vi.fn();
    const onCellClick = vi.fn();
    const year = makeYear();
    render(
      <TaxDetailIncomeTable
        years={[year]}
        onYearClick={onYearClick}
        onCellClick={onCellClick}
      />,
    );
    // Click the Earned Income value: $100,000 (en-US currency formatting).
    await user.click(screen.getByRole("button", { name: /earned income value 100,000/i }));
    expect(onCellClick).toHaveBeenCalledWith(year, "earnedIncome");
  });

  it("zero-value cells are still clickable", async () => {
    const user = userEvent.setup();
    const onCellClick = vi.fn();
    const year = {
      year: 2030, ages: { client: 67 },
      taxResult: { income: {
        earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0, dividends: 0,
        capitalGains: 0, shortCapitalGains: 0, totalIncome: 0, nonTaxableIncome: 0, grossTotalIncome: 0,
      } },
    } as unknown as ProjectionYear;
    render(
      <TaxDetailIncomeTable
        years={[year]}
        onYearClick={() => {}}
        onCellClick={onCellClick}
      />,
    );
    await user.click(screen.getByRole("button", { name: /earned income value 0/i }));
    expect(onCellClick).toHaveBeenCalledWith(year, "earnedIncome");
  });

  it("M5: QBI column reads taxResult.income.qbi (not taxDetail)", () => {
    const y = {
      taxResult: { income: {
        earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0, dividends: 0,
        capitalGains: 0, shortCapitalGains: 0, qbi: 9_000,
        totalIncome: 9_000, nonTaxableIncome: 0, grossTotalIncome: 9_000,
      } },
      // no taxDetail on purpose — the column must not depend on it
    } as never;
    const qbiCol = INCOME_COLUMNS.find((c) => c.key === "qbi")!;
    expect(qbiCol.value(y)).toBe(9_000);
  });

  it("C1: income columns sum to Total Income with STCG present", () => {
    const y = {
      taxResult: { income: {
        earnedIncome: 100_000, taxableSocialSecurity: 0, ordinaryIncome: 25_000,
        dividends: 0, capitalGains: 10_000, shortCapitalGains: 5_000, qbi: 0,
        totalIncome: 135_000, nonTaxableIncome: 0, grossTotalIncome: 135_000,
      } },
    } as never;
    const get = (k: string) => INCOME_COLUMNS.find((c) => c.key === k)!.value(y);
    const sum = get("earnedIncome") + get("taxableSocialSecurity") + get("ordinaryIncome")
      + get("dividends") + get("capitalGains") + get("shortCapitalGains") + get("qbi");
    expect(sum).toBe(get("totalIncome"));
  });
});
