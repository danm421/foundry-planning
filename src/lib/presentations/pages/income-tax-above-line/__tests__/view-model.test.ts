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
  it("maps above-line components with a pinned Total and no chart", () => {
    const d = buildTaxAboveLineDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.retirementContributions).toBe(20_000);
    expect(r.cells.taggedExpenses).toBe(3_000);
    expect(r.cells.total).toBe(24_000);
    expect(d.table.columns.at(-1)!.key).toBe("total");
    expect(d.chartSpec).toBeUndefined();
  });
});
