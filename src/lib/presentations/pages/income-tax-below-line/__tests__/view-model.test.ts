import { describe, it, expect } from "vitest";
import { buildTaxBelowLineDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "lifetime" as const, showCallout: false },
};

describe("buildTaxBelowLineDrillData", () => {
  it("maps itemized components + standard, pinning Deduction Taken (taxDeductions)", () => {
    const d = buildTaxBelowLineDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.charitable).toBe(10_000);
    expect(r.cells.taxesPaid).toBe(10_000);
    expect(r.cells.itemizedTotal).toBe(28_000);
    expect(r.cells.standard).toBe(30_000);
    expect(r.cells.deductionTaken).toBe(30_000); // max(itemized, standard)
    expect(d.table.columns.at(-1)!.key).toBe("deductionTaken");
  });

  it("stacks the itemized components and overlays Standard as a line", () => {
    const d = buildTaxBelowLineDrillData(base);
    expect(d.chartSpec).toBeDefined();
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "charitable", "taxesPaid", "propertyTaxes", "interestPaid", "otherItemized",
    ]);
    expect(d.chartSpec!.lines.map((l) => l.seriesId)).toEqual(["standard"]);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const stackSum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    // The chart stacks the raw itemized components, matching the table's
    // component columns. itemizedTotal can be lower (SALT cap), so compare to
    // the raw component sum rather than itemizedTotal.
    const rawSum =
      r.cells.charitable + r.cells.taxesPaid + r.cells.propertyTaxes +
      r.cells.interestPaid + r.cells.otherItemized;
    expect(stackSum).toBeCloseTo(rawSum);
    expect(d.chartSpec!.lines[0].values[i]).toBeCloseTo(r.cells.standard);
  });
});
