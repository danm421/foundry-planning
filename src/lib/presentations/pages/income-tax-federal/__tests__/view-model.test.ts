import { describe, it, expect } from "vitest";
import { buildTaxFederalDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "full" as const, showCallout: false },
};

describe("buildTaxFederalDrillData", () => {
  it("derives Other = totalTax - regularFederalIncomeTax", () => {
    const d = buildTaxFederalDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.regularFed).toBe(74_000);
    expect(r.cells.other).toBe(23_650); // 97_650 - 74_000
    expect(r.cells.totalTax).toBe(97_650);
  });

  it("emits marginal rate as a 0..1 fraction in a percent column", () => {
    const d = buildTaxFederalDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.marginalRate).toBeCloseTo(0.24);
    expect(d.table.columns.find((c) => c.key === "marginalRate")!.format).toBe("percent");
  });

  it("pins Total Tax as the strong last-but-one column and includes a chart", () => {
    const d = buildTaxFederalDrillData(base);
    expect(d.table.columns.find((c) => c.key === "totalTax")!.strong).toBe(true);
    expect(d.chartSpec).toBeDefined();
  });
});
