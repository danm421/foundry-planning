import { describe, it, expect } from "vitest";
import { selectEntityRows } from "../view-model";
import type { ProjectionYear, EntityCashFlowRow } from "@/engine/types";

function rowFor(year: number, entityId: string): EntityCashFlowRow {
  return {
    kind: "trust", entityId, entityName: "Test", year,
    ages: { client: 60 + (year - 2026) }, trustSubType: "irrevocable", isGrantor: false,
    beginningBalance: 0, transfersIn: 0, growth: 0, income: 0, totalDistributions: 0,
    expenses: 0, taxes: 0, endingBalance: 0,
  };
}

function yearWith(year: number, rows: EntityCashFlowRow[]): ProjectionYear {
  return { year, entityCashFlow: new Map(rows.map(r => [r.entityId, r])) } as unknown as ProjectionYear;
}

describe("selectEntityRows", () => {
  it("returns rows for the chosen entity in the year range", () => {
    const years = [
      yearWith(2026, [rowFor(2026, "trust-1"), rowFor(2026, "trust-2")]),
      yearWith(2027, [rowFor(2027, "trust-1")]),
      yearWith(2028, [rowFor(2028, "trust-1")]),
    ];
    const result = selectEntityRows({ years, entityId: "trust-1", startYear: 2026, endYear: 2027 });
    expect(result.kind).toBe("trust");
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(r => r.year)).toEqual([2026, 2027]);
  });

  it("returns empty rows when the entity has no presence in the window", () => {
    const years = [yearWith(2026, [])];
    const result = selectEntityRows({ years, entityId: "trust-1", startYear: 2026, endYear: 2027 });
    expect(result.rows).toHaveLength(0);
  });
});
