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
    render(<EquityTaxImpactTable model={model} />);
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
    render(<EquityTaxImpactTable model={model} />);
    expect(screen.getByText(/No tax impact/i)).toBeTruthy();
  });
});
