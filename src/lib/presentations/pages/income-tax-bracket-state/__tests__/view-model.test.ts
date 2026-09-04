import { describe, it, expect } from "vitest";
import { buildTaxBracketStateDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
};

describe("buildTaxBracketStateDrillData", () => {
  it("maps state bracket-stacking columns from buildStateBracketRows", () => {
    const d = buildTaxBracketStateDrillData({ ...base, options: { range: "full", showCallout: false } });
    const r = d.table.rows.find((row) => row.year === 2026)!;
    // PA flat 3.07% top tier [0, null]: base 450_000 → into 450_000, remaining null→0.
    expect(r.cells.stateTaxable).toBe(450_000);
    expect(r.cells.marginalRate).toBeCloseTo(0.0307);
    expect(r.cells.intoBracket).toBe(450_000);
    expect(r.cells.remainingInBracket).toBe(0); // top tier (null) rendered as 0
    expect(r.cells.stateTax).toBe(9_000);
  });

  it("emits an Into/Remaining bracket-fill chart (no line)", () => {
    const d = buildTaxBracketStateDrillData({ ...base, options: { range: "full", showCallout: false } });
    expect(d.chartSpec).toBeDefined();
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual(["intoBracket", "remainingInBracket"]);
    expect(d.chartSpec!.lines).toHaveLength(0);
  });

  it("clips to Roth conversion years while keeping Change in Base year-over-year", () => {
    const years = makeTaxYears();
    years.find((y) => y.year === 2036)!.rothConversions = [
      { id: "rc1", name: "Fill the 12% bracket", gross: 40_000, taxable: 40_000, requested: 40_000, limitedBy: null },
    ];
    const d = buildTaxBracketStateDrillData({
      ...base, years, options: { range: "rothConversionYears", showCallout: false },
    });
    expect(d.table.rows.map((r) => r.year)).toEqual([2036]);
    expect(d.chartSpec!.xAxis.domain).toEqual([2036]);
    // 2036 state taxable 63_800 less 2031's 50_800 — the hidden year, not a zero.
    expect(d.table.rows[0].cells.changeInBase).toBe(13_000);
  });

  it("says so, and prints no chart, when the plan has no conversions", () => {
    const d = buildTaxBracketStateDrillData({
      ...base, options: { range: "rothConversionYears", showCallout: false },
    });
    expect(d.table.rows).toHaveLength(0);
    expect(d.chartSpec).toBeUndefined();
    expect(d.footnote).toContain("No Roth conversions are modeled");
  });
});
