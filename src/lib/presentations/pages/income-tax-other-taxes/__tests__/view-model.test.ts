import { describe, it, expect } from "vitest";
import { buildTaxOtherTaxesDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";
import { dataLight } from "@/brand";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "full" as const, showCallout: false },
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
    // Reuse the Federal TAX_STACK tokens.
    const byId = Object.fromEntries(d.chartSpec!.stacks.map((s) => [s.seriesId, s.color]));
    expect(byId.capitalGainsTax).toBe(dataLight.yellow);
    expect(byId.fica).toBe(dataLight.green);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const sum = d.chartSpec!.stacks.reduce((a, s) => a + s.values[i], 0);
    expect(sum).toBeCloseTo(r.cells.total);
  });

  it("C2: Other-Taxes components (incl. penalty) sum to the total", () => {
    const y = { year: 2030, ages: { client: 58 }, taxResult: { flow: {
      regularFederalIncomeTax: 30_000, capitalGainsTax: 0, amtAdditional: 0, niit: 0,
      additionalMedicare: 0, fica: 0, stateTax: 2_000, earlyWithdrawalPenalty: 1_000,
      totalTax: 33_000,
    } } } as never;
    const data = buildTaxOtherTaxesDrillData({
      years: [y], clientData: makeClientData(),
      options: { range: "full", showCallout: false } as never,
      scenarioLabel: "B", clientName: "T", spouseName: null,
    });
    const r = data.table.rows[0].cells;
    const componentSum = r.capitalGainsTax + r.amt + r.niit + r.additionalMedicare
      + r.fica + r.stateTax + r.earlyWithdrawalPenalty;
    expect(componentSum).toBe(r.total); // total = totalTax − regularFed = 3_000
  });
});
