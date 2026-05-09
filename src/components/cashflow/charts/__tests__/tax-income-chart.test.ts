import { describe, it, expect } from "vitest";
import { buildTaxIncomeDatasets } from "../tax-income-chart";
import { makeYear } from "./fixtures";

describe("buildTaxIncomeDatasets", () => {
  it("returns one series per taxable-income component", () => {
    const labels = buildTaxIncomeDatasets().map((s) => s.label);
    expect(labels).toEqual([
      "Earned",
      "Ordinary",
      "Qualified Dividends",
      "LT Capital Gains",
      "ST Capital Gains",
      "QBI",
      "Tax-Exempt",
    ]);
  });

  it("returns zero when taxDetail is absent", () => {
    const series = buildTaxIncomeDatasets();
    const y = makeYear({ year: 2026 });
    expect(series[0].valueFor(y)).toBe(0);
  });

  it("reads matching field when taxDetail is present", () => {
    const series = buildTaxIncomeDatasets();
    const y = makeYear({
      year: 2026,
      taxDetail: {
        earnedIncome: 100_000,
        ordinaryIncome: 30_000,
        dividends: 4_000,
        capitalGains: 8_000,
        stCapitalGains: 1_000,
        qbi: 2_000,
        taxExempt: 500,
        bySource: {},
      },
    });
    expect(series.find((s) => s.label === "Earned")!.valueFor(y)).toBe(100_000);
    expect(series.find((s) => s.label === "Qualified Dividends")!.valueFor(y)).toBe(4_000);
    expect(series.find((s) => s.label === "LT Capital Gains")!.valueFor(y)).toBe(8_000);
    expect(series.find((s) => s.label === "ST Capital Gains")!.valueFor(y)).toBe(1_000);
  });
});
