// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EquityTaxImpactTable from "@/components/stock-options/equity-tax-impact-table";
import type { EquityTaxImpactModel, EquityTaxImpactRow } from "@/engine/equity/tax-impact";

function r(over: Partial<EquityTaxImpactRow>): EquityTaxImpactRow {
  return {
    year: 2027, ordinaryIncome: 0, isoSpread: 0, capitalGains: 0, totalIncome: 0,
    fedIncomeTax: 0, capGainsTax: 0, payrollTax: 0, stateTax: 0, totalTax: 0, netIncome: 0, ...over,
  };
}

describe("EquityTaxImpactTable", () => {
  it("renders a per-year row, the Totals row, and the column headers", () => {
    const row = r({ year: 2027, ordinaryIncome: 90_000, totalIncome: 90_000, fedIncomeTax: 18_000, payrollTax: 5_000, stateTax: 4_000, totalTax: 27_000, netIncome: 63_000 });
    const model: EquityTaxImpactModel = { rows: [row], totals: { ...row, year: 0 }, hasActivity: true };
    render(<EquityTaxImpactTable model={model} taxMode="bracket" />);
    expect(screen.getByText("2027")).toBeTruthy();
    expect(screen.getByText(/Earned Income/i)).toBeTruthy();
    expect(screen.getByText(/Capital Gains Tax/i)).toBeTruthy();
    expect(screen.getByText(/Net Option Income/i)).toBeTruthy();
    expect(screen.getByText(/Totals/i)).toBeTruthy();
  });

  it("shows the empty state when there is no activity", () => {
    const model: EquityTaxImpactModel = {
      rows: [],
      totals: { year: 0, ordinaryIncome: 0, isoSpread: 0, capitalGains: 0, totalIncome: 0, fedIncomeTax: 0, capGainsTax: 0, payrollTax: 0, stateTax: 0, totalTax: 0, netIncome: 0 },
      hasActivity: false,
    };
    render(<EquityTaxImpactTable model={model} taxMode="bracket" />);
    expect(screen.getByText(/No tax impact/i)).toBeTruthy();
  });
});

describe("EquityTaxImpactTable — an exercise-and-hold year", () => {
  // Every fixture above is all-zero apart from ordinary income, so the ISO
  // Spread column never carried a number: hard-wiring it to zero used to leave
  // this suite green. An exercise-and-hold year is the case the table exists for.
  const row = r({
    year: 2028, isoSpread: 555_000, fedIncomeTax: 141_279,
    totalTax: 141_279, netIncome: -141_279,
  });
  const model: EquityTaxImpactModel = { rows: [row], totals: { ...row, year: 0 }, hasActivity: true };

  it("renders the ISO spread and the AMT-driven federal tax in bracket mode", () => {
    render(<EquityTaxImpactTable model={model} taxMode="bracket" />);
    // Year row and Totals row both carry the ISO spread. The tax figure appears
    // four times: Federal Income Tax and Total Option Tax are the same number
    // here (AMT is the only tax this year), once per row.
    expect(screen.getAllByText("$555K")).toHaveLength(2);
    expect(screen.getAllByText("$141.3K")).toHaveLength(4);
  });

  it("discloses that the AMT shown never comes back (audit F4)", () => {
    // The screen an advisor decides "exercise and hold?" on. Without this, the
    // Totals row reads as a permanent cost and inverts the recommendation.
    render(<EquityTaxImpactTable model={model} taxMode="bracket" />);
    expect(screen.getByText(/does not model the minimum tax credit/i)).toBeTruthy();
    expect(screen.getByText(/overstates the cost of exercising and holding/i)).toBeTruthy();
  });

  it("says AMT is not modelled in flat-rate mode instead of printing a spread (audit F15)", () => {
    // Flat mode hardcodes AMT to zero and never receives the option spread, so a
    // populated ISO Spread column here sits against $0 of tax.
    render(<EquityTaxImpactTable model={model} taxMode="flat" />);
    expect(screen.queryByText("$555K")).toBeNull();
    expect(screen.getAllByText("not modelled")).toHaveLength(2); // year row + Totals
    expect(screen.getByText(/AMT is not modelled in flat-rate mode/i)).toBeTruthy();
  });

  it("drops the AMT promise from the Federal Income Tax tooltip in flat mode", () => {
    // The third sentence promising AMT is inside the federal column. It is as
    // false as the other two when the engine computes none.
    const { rerender } = render(<EquityTaxImpactTable model={model} taxMode="bracket" />);
    expect(screen.getByText("Federal Income Tax").getAttribute("title")).toMatch(/plus AMT/i);
    rerender(<EquityTaxImpactTable model={model} taxMode="flat" />);
    const flatTip = screen.getByText("Federal Income Tax").getAttribute("title")!;
    expect(flatTip).not.toMatch(/plus AMT/i);
    expect(flatTip).toMatch(/not modelled in flat-rate mode/i);
  });
});
