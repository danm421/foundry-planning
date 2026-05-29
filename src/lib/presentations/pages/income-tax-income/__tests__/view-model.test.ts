import { describe, it, expect } from "vitest";
import { buildTaxIncomeDrillData } from "../view-model";
import { makeTaxYears, makeClientData } from "@/lib/presentations/shared/__tests__/tax-fixtures";

const base = {
  years: makeTaxYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
};

describe("buildTaxIncomeDrillData", () => {
  it("titles the page and carries the scenario label", () => {
    const d = buildTaxIncomeDrillData({ ...base, options: { range: "lifetime", showCallout: false } });
    expect(d.title).toBe("Income Tax — Income");
    expect(d.subtitle).toBe("Base Case");
  });

  it("maps income fields for 2026 with grossTotalIncome pinned last", () => {
    const d = buildTaxIncomeDrillData({ ...base, options: { range: "lifetime", showCallout: false } });
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.earned).toBe(400_000);
    expect(r.cells.ltcg).toBe(9_000);
    expect(r.cells.qbi).toBe(9_000);
    expect(r.cells.gross).toBe(453_000);
    expect(d.table.columns.at(-1)!.key).toBe("gross");
    expect(d.table.columns.at(-1)!.strong).toBe(true);
  });

  it("filters to retirement-onward years (drops 2026) and includes a chart", () => {
    const d = buildTaxIncomeDrillData({ ...base, options: { range: "retirement", showCallout: false } });
    expect(d.table.rows.map((r) => r.year)).toEqual([2031, 2036]);
    expect(d.chartSpec).toBeDefined();
  });
});
