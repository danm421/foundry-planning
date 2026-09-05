// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectionYear } from "@/engine/types";
import {
  TaxDetailIncomeTable,
  INCOME_COLUMNS,
  visibleIncomeColumns,
} from "../tax-detail-income-table";

/** Task 9 income-column fixture: a year carrying one `tax_adjustment:` entry
 *  in `taxDetail.bySource`, of the given tax type. */
function makeYearWithAdjustment(taxType: string, amount: number): ProjectionYear {
  return {
    year: 2030,
    ages: { client: 67 },
    taxDetail: {
      bySource: { "tax_adjustment:adj-1": { type: taxType, amount } },
    },
    taxResult: {
      income: {
        earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0,
        dividends: 0, capitalGains: 0, shortCapitalGains: 0, qbi: 0,
        totalIncome: 0, nonTaxableIncome: 0, grossTotalIncome: 0,
      },
    },
  } as unknown as ProjectionYear;
}

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

  it("T9: a tax_adjustment bySource entry renders in the Tax Adjustments cell", () => {
    const year = makeYearWithAdjustment("ordinary_income", 12_000);
    render(
      <TaxDetailIncomeTable years={[year]} onYearClick={() => {}} onCellClick={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: /tax adjustments value 12,000/i }),
    ).toBeInTheDocument();
  });

  it("T9: the Tax Adjustments column hides itself when no year has an adjustment", () => {
    const year = makeYear(); // no taxDetail at all — no adjustments anywhere
    render(
      <TaxDetailIncomeTable years={[year]} onYearClick={() => {}} onCellClick={() => {}} />,
    );
    expect(screen.queryByText(/of which: tax adjustments/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /tax adjustments value/i }),
    ).not.toBeInTheDocument();
  });

  it("the Tax Adjustments column sits OUTSIDE the additive run, after Gross Total Income", () => {
    // The money is already inside Ordinary Income (or whichever bucket the
    // adjustment feeds). Printed between QBI and Total Income it reads as an
    // addend and an advisor scanning the row sees the same $750,000 twice.
    const keys = visibleIncomeColumns([makeYearWithAdjustment("ordinary_income", 750_000)]).map(
      (c) => c.key,
    );
    expect(keys[keys.length - 1]).toBe("taxAdjustments");
    expect(keys.indexOf("taxAdjustments")).toBeGreaterThan(keys.indexOf("grossTotalIncome"));
    expect(INCOME_COLUMNS.find((c) => c.key === "taxAdjustments")!.memo).toBe(true);
  });

  it("freezes BOTH totals columns on the right when the memo column is showing", () => {
    // One sticky column would let Gross Total Income scroll away and leave the
    // memo alone at the right edge — the bottom line has to stay anchored.
    const { container } = render(
      <TaxDetailIncomeTable
        years={[makeYearWithAdjustment("ordinary_income", 750_000)]}
        onYearClick={() => {}}
        onCellClick={() => {}}
      />,
    );
    const headers = Array.from(container.querySelectorAll("thead th"));
    const memo = headers[headers.length - 1];
    const grossTotal = headers[headers.length - 2];
    expect(memo.className).toContain("right-0");
    expect(memo.className).toContain("w-40");
    expect(grossTotal.className).toContain("right-40");
  });

  it("freezes only Gross Total Income when there are no adjustments", () => {
    const { container } = render(
      <TaxDetailIncomeTable years={[makeYear()]} onYearClick={() => {}} onCellClick={() => {}} />,
    );
    const headers = Array.from(container.querySelectorAll("thead th"));
    expect(headers[headers.length - 1].className).toContain("right-0");
    expect(headers.filter((h) => h.className.includes("right-40"))).toHaveLength(0);
  });

  it("the memo column is the ONLY column flagged memo — the rest stay additive", () => {
    expect(INCOME_COLUMNS.filter((c) => c.memo).map((c) => c.key)).toEqual(["taxAdjustments"]);
  });

  it("Total Income still excludes the adjustment the memo column repeats", () => {
    // Engine-side proof of the same point: the columns that sum to Total Income
    // already carry the adjustment once, via the bucket it was entered against.
    const y = {
      taxDetail: { bySource: { "tax_adjustment:adj-1": { type: "ordinary_income", amount: 750_000 } } },
      taxResult: { income: {
        earnedIncome: 0, taxableSocialSecurity: 20_545, ordinaryIncome: 771_007,
        dividends: 15_223, capitalGains: 589_467, shortCapitalGains: 0, qbi: 0,
        totalIncome: 1_396_242, nonTaxableIncome: 3_625, grossTotalIncome: 1_399_867,
      } },
    } as never;
    const get = (k: string) => INCOME_COLUMNS.find((c) => c.key === k)!.value(y);
    const additive = INCOME_COLUMNS
      .filter((c) => !c.memo && !["totalIncome", "nonTaxableIncome", "grossTotalIncome"].includes(c.key))
      .reduce((s, c) => s + c.value(y), 0);
    expect(additive).toBe(get("totalIncome"));
    expect(get("taxAdjustments")).toBe(750_000);
  });

  it("T9: a tax_exempt adjustment shows in Tax Adjustments while no taxable bucket moves", () => {
    // sumTaxAdjustments deliberately counts tax_exempt rows (Task 2, Correction
    // 5): the column is "income entered as already having happened", not
    // "taxable income", so a tax_exempt adjustment appears here while moving
    // no taxable taxResult.income bucket.
    const y = makeYearWithAdjustment("tax_exempt", 7_500);
    const get = (k: string) => INCOME_COLUMNS.find((c) => c.key === k)!.value(y);
    expect(get("taxAdjustments")).toBe(7_500);
    expect(get("ordinaryIncome")).toBe(0);
    expect(get("earnedIncome")).toBe(0);
    expect(get("totalIncome")).toBe(0);
  });
});
