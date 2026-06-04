import { describe, it, expect } from "vitest";
import { buildTaxStateDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "full" as const, showCallout: false },
};

describe("buildTaxStateDrillData", () => {
  it("maps state-flow fields and pins State Tax", () => {
    const d = buildTaxStateDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.federalBase).toBe(450_000);
    expect(r.cells.stateTaxable).toBe(450_000);
    expect(r.cells.stateTax).toBe(9_000);
    expect(d.table.columns.find((c) => c.key === "stateTax")!.strong).toBe(true);
  });

  it("computes effective rate = stateTax / startingIncome as a fraction", () => {
    const d = buildTaxStateDrillData(base);
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.effRate).toBeCloseTo(0.02); // 9_000 / 450_000
    expect(d.table.columns.find((c) => c.key === "effRate")!.format).toBe("percent");
  });
});
