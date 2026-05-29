import { describe, it, expect } from "vitest";
import { buildTaxBracketFederalDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
};

describe("buildTaxBracketFederalDrillData", () => {
  it("maps bracket-stacking columns from buildTaxBracketRows", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, options: { range: "lifetime", showCallout: false } });
    const r = d.table.rows.find((row) => row.year === 2026)!;
    // incomeTaxBase 384_200 sits in the 24% tier [383_900, 487_450].
    expect(r.cells.incomeTaxBase).toBe(384_200);
    expect(r.cells.marginalRate).toBeCloseTo(0.24);
    expect(r.cells.intoBracket).toBe(300);          // 384_200 - 383_900
    expect(r.cells.remainingInBracket).toBe(103_250); // 487_450 - 384_200
    expect(d.chartSpec).toBeUndefined();
    expect(d.table.columns.find((c) => c.key === "changeInBase")!.signColor).toBe(true);
  });

  it("first visible year has changeInBase 0; later years show the delta", () => {
    const d = buildTaxBracketFederalDrillData({ ...base, options: { range: "lifetime", showCallout: false } });
    expect(d.table.rows[0].cells.changeInBase).toBe(0);
  });
});
