import { describe, it, expect } from "vitest";
import { buildTaxOtherTaxesDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "lifetime" as const, showCallout: false },
};

describe("buildTaxOtherTaxesDrillData", () => {
  it("breaks out the Other bucket and totals it (= Federal page Other)", () => {
    const d = buildTaxOtherTaxesDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.capitalGainsTax).toBe(1_350);
    expect(r.cells.niit).toBe(300);
    expect(r.cells.fica).toBe(13_000);
    expect(r.cells.stateTax).toBe(9_000);
    expect(r.cells.total).toBe(23_650); // 1_350 + 0 + 300 + 0 + 13_000 + 9_000
    expect(d.chartSpec).toBeDefined();
  });

  it("emits a 6-series stacked chart summing to the Other total", () => {
    const d = buildTaxOtherTaxesDrillData(base);
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "capitalGainsTax", "amt", "niit", "additionalMedicare", "fica", "stateTax",
    ]);
    // Reuse the Federal TAX_STACK hexes.
    const byId = Object.fromEntries(d.chartSpec!.stacks.map((s) => [s.seriesId, s.color]));
    expect(byId.capitalGainsTax).toBe("#facc15");
    expect(byId.fica).toBe("#16a34a");
    const r = d.table.rows.find((row) => row.year === 2026)!;
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const sum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    expect(sum).toBeCloseTo(r.cells.total);
  });
});
