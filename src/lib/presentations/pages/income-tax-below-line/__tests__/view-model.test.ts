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
    expect(d.chartSpec).toBeUndefined();
  });
});
