import { describe, it, expect } from "vitest";
import type { ProjectionYear, TrustCashFlowRow, BusinessCashFlowRow } from "@/engine/types";
import { buildEntityCashFlowPageData } from "../build-data";

const trustRow: TrustCashFlowRow = {
  kind: "trust",
  entityId: "t1",
  entityName: "Smith Family Trust",
  year: 2026,
  ages: { client: 60 },
  trustSubType: "irrevocable",
  isGrantor: false,
  beginningBalance: 1_000_000,
  transfersIn: 0,
  growth: 50_000,
  income: 20_000,
  totalDistributions: 10_000,
  expenses: 5_000,
  taxes: 3_000,
  endingBalance: 1_052_000,
};

const businessRow: BusinessCashFlowRow = {
  kind: "business",
  entityId: "b1",
  entityName: "ABC Holdings LLC",
  year: 2026,
  ages: { client: 60 },
  entityType: "llc",
  beginningTotalValue: 2_000_000,
  beginningBasis: 500_000,
  growth: 100_000,
  income: 80_000,
  expenses: 20_000,
  annualDistribution: 40_000,
  retainedEarnings: 20_000,
  endingTotalValue: 2_120_000,
  endingBasis: 500_000,
};

function fakeYear(year: number, rows: Array<TrustCashFlowRow | BusinessCashFlowRow>): ProjectionYear {
  return {
    year,
    entityCashFlow: new Map(rows.map((r) => [r.entityId, r])),
  } as unknown as ProjectionYear;
}

describe("buildEntityCashFlowPageData", () => {
  it("selects the trust rows and titles the page", () => {
    const data = buildEntityCashFlowPageData({
      years: [fakeYear(2026, [trustRow, businessRow])],
      entityId: "t1",
      entityName: "Smith Family Trust",
      range: "full",
      scenarioLabel: "Base Case",
    });
    expect(data.selected.kind).toBe("trust");
    expect(data.selected.rows).toHaveLength(1);
    expect(data.title).toBe("Business & Trusts — Smith Family Trust");
    expect(data.subtitle).toBe("Base Case");
  });

  it("selects business rows when the business is picked", () => {
    const data = buildEntityCashFlowPageData({
      years: [fakeYear(2026, [trustRow, businessRow])],
      entityId: "b1",
      entityName: "ABC Holdings LLC",
      range: "full",
      scenarioLabel: "Base Case",
    });
    expect(data.selected.kind).toBe("business");
    expect(data.title).toBe("Business & Trusts — ABC Holdings LLC");
  });

  it("clips to a custom year range", () => {
    const data = buildEntityCashFlowPageData({
      years: [fakeYear(2026, [trustRow]), fakeYear(2027, [{ ...trustRow, year: 2027 }])],
      entityId: "t1",
      entityName: "Smith Family Trust",
      range: { startYear: 2027, endYear: 2027 },
      scenarioLabel: "Base Case",
    });
    expect(data.selected.rows.map((r) => r.year)).toEqual([2027]);
  });

  it("returns the empty kind when nothing is selected", () => {
    const data = buildEntityCashFlowPageData({
      years: [fakeYear(2026, [trustRow])],
      entityId: "",
      entityName: "",
      range: "full",
      scenarioLabel: "Base Case",
    });
    expect(data.selected.kind).toBe("empty");
    expect(data.title).toBe("Business & Trusts");
  });
});
