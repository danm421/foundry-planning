import { describe, it, expect, vi } from "vitest";
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

vi.mock("@/lib/estate/yearly-liquidity-report", () => ({
  buildYearlyLiquidityReport: vi.fn(),
}));
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { buildEstateLiquidityDrillData } from "../view-model";

function mockReport(): YearlyLiquidityReport {
  return {
    rows: [
      {
        year: 2026, ageClient: 56, ageSpouse: 51,
        insuranceInEstate: 500_000, insuranceOutOfEstate: 1_000_000,
        totalInsuranceBenefit: 1_500_000, totalPortfolioAssets: 1_618_497,
        totalTransferCost: 191_896,
        surplusDeficitWithPortfolio: 2_926_601, surplusDeficitInsuranceOnly: 1_308_104,
      },
    ],
    totals: {
      insuranceInEstate: 500_000, insuranceOutOfEstate: 1_000_000,
      totalInsuranceBenefit: 1_500_000, totalPortfolioAssets: 1_618_497,
      totalTransferCost: 191_896,
      surplusDeficitWithPortfolio: 2_926_601, surplusDeficitInsuranceOnly: 1_308_104,
    },
  };
}

const base = {
  projection: { years: [{ year: 2026 }], firstDeathEvent: { deceased: "client" } } as never,
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "full" as const, showCallout: false },
};

describe("buildEstateLiquidityDrillData", () => {
  it("maps Liquidity columns with Surplus/Deficit pinned and sign-colored", () => {
    vi.mocked(buildYearlyLiquidityReport).mockReturnValue(mockReport());
    const d = buildEstateLiquidityDrillData(base);
    expect(d.title).toBe("Estate Liquidity");
    const r = d.table.rows.find((row) => row.year === 2026)!;
    expect(r.cells.totalInsuranceBenefit).toBe(1_500_000);
    expect(r.cells.totalTransferCost).toBe(191_896);
    expect(r.cells.surplusDeficit).toBe(2_926_601);
    const last = d.table.columns.at(-1)!;
    expect(last.key).toBe("surplusDeficit");
    expect(last.strong).toBe(true);
    expect(last.signColor).toBe(true);
  });

  it("builds a chart with portfolio+insurance stacks and a transfer-cost line", () => {
    vi.mocked(buildYearlyLiquidityReport).mockReturnValue(mockReport());
    const d = buildEstateLiquidityDrillData(base);
    expect(d.chartSpec).toBeDefined();
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual([
      "totalPortfolioAssets", "totalInsuranceBenefit",
    ]);
    expect(d.chartSpec!.lines.map((l) => l.seriesId)).toEqual(["totalTransferCost"]);
  });

  // F84: the liquidity drill must use the natural death ordering so its transfer
  // costs agree with the sibling Estate Transfer drill (which uses naturalOrdering).
  it("forwards the natural death ordering to the report (spouse dies first)", () => {
    vi.mocked(buildYearlyLiquidityReport).mockClear();
    vi.mocked(buildYearlyLiquidityReport).mockReturnValue(mockReport());
    buildEstateLiquidityDrillData({
      ...base,
      projection: { years: [{ year: 2026 }], firstDeathEvent: { deceased: "spouse" } } as never,
    });
    expect(buildYearlyLiquidityReport).toHaveBeenCalledWith(
      expect.objectContaining({ ordering: "spouseFirst" }),
    );
  });

  it("forwards primaryFirst when the client dies first", () => {
    vi.mocked(buildYearlyLiquidityReport).mockClear();
    vi.mocked(buildYearlyLiquidityReport).mockReturnValue(mockReport());
    buildEstateLiquidityDrillData(base);
    expect(buildYearlyLiquidityReport).toHaveBeenCalledWith(
      expect.objectContaining({ ordering: "primaryFirst" }),
    );
  });
});
