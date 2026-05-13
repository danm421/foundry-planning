import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { buildConversionCellDrill } from "../bracket-conversions";
import type { CellDrillContext } from "../types";

const ctx: CellDrillContext = { accountNames: {}, incomes: [], accounts: [] };

function makeYear(conversions: { id: string; name: string; gross: number; taxable: number }[]): ProjectionYear {
  return {
    year: 2032,
    ages: { client: 70, spouse: 68 },
    rothConversions: conversions,
  } as unknown as ProjectionYear;
}

describe("buildConversionCellDrill", () => {
  it("conversionGross lists each conversion's gross amount", () => {
    const year = makeYear([
      { id: "cv_1", name: "Trad IRA → Roth IRA", gross: 50_000, taxable: 45_000 },
      { id: "cv_2", name: "401k → Roth IRA", gross: 25_000, taxable: 25_000 },
    ]);
    const props = buildConversionCellDrill({ year, columnKey: "conversionGross", ctx });
    expect(props.title).toBe("Roth Conversion (Gross) — 2032");
    expect(props.total).toBe(75_000);
    expect(props.groups[0].rows).toEqual([
      { id: "cv_1", label: "Trad IRA → Roth IRA", amount: 50_000, meta: "$45,000 taxable" },
      { id: "cv_2", label: "401k → Roth IRA", amount: 25_000, meta: "$25,000 taxable" },
    ]);
  });

  it("conversionTaxable lists each conversion's taxable amount", () => {
    const year = makeYear([
      { id: "cv_1", name: "Trad IRA → Roth IRA", gross: 50_000, taxable: 45_000 },
    ]);
    const props = buildConversionCellDrill({ year, columnKey: "conversionTaxable", ctx });
    expect(props.title).toBe("Roth Conversion (Taxable) — 2032");
    expect(props.total).toBe(45_000);
    expect(props.groups[0].rows[0]).toEqual({
      id: "cv_1", label: "Trad IRA → Roth IRA", amount: 45_000, meta: "$50,000 gross",
    });
  });

  it("returns empty group when there are no conversions", () => {
    const year = { year: 2032, ages: { client: 70 }, rothConversions: undefined } as unknown as ProjectionYear;
    const props = buildConversionCellDrill({ year, columnKey: "conversionGross", ctx });
    expect(props.total).toBe(0);
    expect(props.groups[0].rows).toEqual([]);
  });

  it("rejects intoBracket — adapter is conversion-only", () => {
    const year = makeYear([]);
    expect(() => buildConversionCellDrill({ year, columnKey: "intoBracket", ctx }))
      .toThrow(/conversion/i);
  });
});
