import { describe, it, expect, vi } from "vitest";
import type { YearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

// Mock the estate builder so the test asserts adapter mapping, not estate math.
vi.mock("@/lib/estate/yearly-estate-report", () => ({
  buildYearlyEstateReport: vi.fn(),
}));
import { buildYearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import { buildEstateTransferDrillData } from "../view-model";

function mockReport(): YearlyEstateReport {
  return {
    ordering: "primaryFirst",
    rows: [
      {
        year: 2026, ageClient: 56, ageSpouse: 51,
        grossEstate: 5_203_497, taxesAndExpenses: 191_896, charitableBequests: 0,
        netToHeirs: 5_011_601, heirsAssets: 1_048_900, totalToHeirs: 6_060_501,
        charity: 0, deaths: [],
      },
    ],
    totals: {
      taxesAndExpenses: 191_896, charitableBequests: 0, netToHeirs: 5_011_601,
      heirsAssets: 1_048_900, totalToHeirs: 6_060_501, charity: 0,
    },
  };
}

const projection = {
  years: [{ year: 2026 }],
  firstDeathEvent: { deceased: "client" },
} as never;

const base = {
  projection,
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "lifetime" as const, showCallout: false },
};

describe("buildEstateTransferDrillData", () => {
  it("titles the page and maps Transfer columns with Total to Heirs pinned", () => {
    vi.mocked(buildYearlyEstateReport).mockReturnValue(mockReport());
    const d = buildEstateTransferDrillData(base);
    expect(d.title).toBe("Estate Transfer");
    expect(d.subtitle).toBe("Base Case");
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.grossEstate).toBe(5_203_497);
    expect(r.cells.taxesAndExpenses).toBe(191_896);
    expect(r.cells.totalToHeirs).toBe(6_060_501);
    expect(d.table.columns.at(-1)!.key).toBe("totalToHeirs");
    expect(d.table.columns.at(-1)!.strong).toBe(true);
  });

  it("selects primaryFirst ordering when the client dies first", () => {
    vi.mocked(buildYearlyEstateReport).mockReturnValue(mockReport());
    buildEstateTransferDrillData(base);
    expect(vi.mocked(buildYearlyEstateReport).mock.calls.at(-1)![0].ordering).toBe("primaryFirst");
  });

  it("selects spouseFirst ordering when the spouse dies first", () => {
    vi.mocked(buildYearlyEstateReport).mockReturnValue(mockReport());
    buildEstateTransferDrillData({
      ...base,
      projection: { years: [{ year: 2026 }], firstDeathEvent: { deceased: "spouse" } } as never,
    });
    expect(vi.mocked(buildYearlyEstateReport).mock.calls.at(-1)![0].ordering).toBe("spouseFirst");
  });

  it("builds a chart with three stacks (net, taxes, charitable)", () => {
    vi.mocked(buildYearlyEstateReport).mockReturnValue(mockReport());
    const d = buildEstateTransferDrillData(base);
    expect(d.chartSpec).toBeDefined();
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "netToHeirs", "taxesAndExpenses", "charitableBequests",
    ]);
  });
});
