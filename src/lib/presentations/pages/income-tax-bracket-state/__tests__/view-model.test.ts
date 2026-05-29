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
    const d = buildTaxBracketStateDrillData({ ...base, options: { range: "lifetime", showCallout: false } });
    const r = d.table.rows.find((row) => row.year === 2026)!;
    // PA flat 3.07% top tier [0, null]: base 450_000 → into 450_000, remaining null→0.
    expect(r.cells.stateTaxable).toBe(450_000);
    expect(r.cells.marginalRate).toBeCloseTo(0.0307);
    expect(r.cells.intoBracket).toBe(450_000);
    expect(r.cells.remainingInBracket).toBe(0); // top tier (null) rendered as 0
    expect(r.cells.stateTax).toBe(9_000);
    expect(d.chartSpec).toBeUndefined();
  });
});
