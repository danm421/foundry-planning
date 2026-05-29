import { describe, it, expect } from "vitest";
import { buildTaxAboveLineDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "lifetime" as const, showCallout: false },
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

  it("emits a 3-series stacked chart summing to the Total column", () => {
    const d = buildTaxAboveLineDrillData(base);
    expect(d.chartSpec).toBeDefined();
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "retirementContributions", "taggedExpenses", "manualEntries",
    ]);
    expect(d.chartSpec!.lines).toHaveLength(0);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const sum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    expect(sum).toBeCloseTo(r.cells.total);
  });
});
