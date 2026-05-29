import { describe, it, expect } from "vitest";
import { buildPortfolioGrowthDrillData } from "../view-model";
import { makeProjectionYears, makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

const base = {
  years: makeProjectionYears(),
  clientData: makeClientData(),
  scenarioLabel: "Base Case",
  clientName: "Cooper",
  spouseName: "Susan" as string | null,
  options: { range: "lifetime" as const, showCallout: false },
};

describe("buildPortfolioGrowthDrillData — chart", () => {
  it("emits a stacked chart whose series match the active categories", () => {
    const d = buildPortfolioGrowthDrillData(base);
    expect(d.chartSpec).toBeDefined();
    const ids = d.chartSpec!.stacks.map((s) => s.seriesId);
    // 2026 has growth in taxable (brokerage 12k) and retirement (ira 8k) only.
    expect(ids).toEqual(["taxable", "retirement"]);
    expect(d.chartSpec!.lines).toHaveLength(0);
  });

  it("uses the in-app portfolio category colors", () => {
    const d = buildPortfolioGrowthDrillData(base);
    const byId = Object.fromEntries(d.chartSpec!.stacks.map((s) => [s.seriesId, s.color]));
    expect(byId.taxable).toBe("#facc15");
    expect(byId.retirement).toBe("#f97316");
  });

  it("chart values per category match the 2026 table row", () => {
    const d = buildPortfolioGrowthDrillData(base);
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const taxable = d.chartSpec!.stacks.find((s) => s.seriesId === "taxable")!;
    const retirement = d.chartSpec!.stacks.find((s) => s.seriesId === "retirement")!;
    expect(taxable.values[i]).toBe(12_000);
    expect(retirement.values[i]).toBe(8_000);
  });
});
