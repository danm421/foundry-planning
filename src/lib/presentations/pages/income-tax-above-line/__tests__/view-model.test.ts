import { describe, it, expect } from "vitest";
import { buildTaxAboveLineDrillData } from "../view-model";
import { makeTaxYears, makeClientData, makeDeductionBreakdown } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "full" as const, showCallout: false },
};

describe("buildTaxAboveLineDrillData", () => {
  it("maps above-line components with a pinned Total", () => {
    const d = buildTaxAboveLineDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.retirementContributions).toBe(20_000);
    expect(r.cells.taggedExpenses).toBe(3_000);
    expect(r.cells.total).toBe(24_000);
    expect(d.table.columns.at(-1)!.key).toBe("total");
  });

  it("emits a 4-series stacked chart summing to the Total column", () => {
    const d = buildTaxAboveLineDrillData(base);
    expect(d.chartSpec).toBeDefined();
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "retirementContributions", "taggedExpenses", "manualEntries", "studentLoanInterest",
    ]);
    expect(d.chartSpec!.lines).toHaveLength(0);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const sum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    expect(sum).toBeCloseTo(r.cells.total);
  });

  it("carries student-loan interest into its own column and chart series", () => {
    // The shared fixture leaves studentLoanInterest at 0, so override just the
    // 2026 breakdown: 20,000 + 3,000 + 1,000 + 2,500 = 26,500.
    const years = makeTaxYears();
    years[0] = {
      ...years[0],
      deductionBreakdown: makeDeductionBreakdown({
        aboveLine: {
          retirementContributions: 20_000, taggedExpenses: 3_000,
          manualEntries: 1_000, studentLoanInterest: 2_500, total: 26_500,
        },
      }),
    };
    const d = buildTaxAboveLineDrillData({ ...base, years });
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.studentLoanInterest).toBe(2_500);
    expect(r.cells.total).toBe(26_500);
    // Without the fourth stack the series would sum to 24,000, not 26,500.
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const sum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    expect(sum).toBeCloseTo(26_500);
  });

  it("declares a COLUMN for every cell key it emits, in render order", () => {
    // ⚠️ The cells, the chart series and the columns are three INDEPENDENT
    // lists in this module. The tests above assert the first two, so deleting
    // the `studentLoanInterest` entry from the `columns` array alone left the
    // row data and the chart intact and every test green — while the column
    // disappeared from the rendered table. Verified by mutation: removing that
    // one line reddened nothing before this test existed.
    const d = buildTaxAboveLineDrillData(base);
    expect(d.table.columns.map((c) => c.key)).toEqual([
      "retirementContributions", "taggedExpenses", "manualEntries",
      "studentLoanInterest", "total",
    ]);
    // Every declared column must be populated by every row, and every cell key
    // must have a column — the two lists agreeing is the actual invariant.
    for (const row of d.table.rows) {
      expect(Object.keys(row.cells).sort()).toEqual(d.table.columns.map((c) => c.key).sort());
    }
  });
});
