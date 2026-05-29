import { describe, it, expect } from "vitest";
import { buildPortfolioActivityDrillData } from "../view-model";
import { makeProjectionYears, makeClientData } from "@/lib/presentations/pages/cash-flow/__tests__/fixtures";

function baseInput() {
  return {
    years: makeProjectionYears(),
    clientData: makeClientData(),
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan" as string | null,
    options: { range: "lifetime" as const, showCallout: false },
  };
}

describe("buildPortfolioActivityDrillData — chart", () => {
  it("emits Additions (up), Distributions (down) and a Net line", () => {
    const d = buildPortfolioActivityDrillData(baseInput());
    expect(d.chartSpec).toBeDefined();
    expect(d.chartSpec!.stacks.map((s) => s.seriesId)).toEqual(["additions", "distributions"]);
    expect(d.chartSpec!.lines.map((l) => l.seriesId)).toEqual(["net"]);
    const byId = Object.fromEntries(d.chartSpec!.stacks.map((s) => [s.seriesId, s.color]));
    expect(byId.additions).toBe("#16a34a");
    expect(byId.distributions).toBe("#ef4444");
  });

  it("passes distributions as negative values and net = additions - distributions", () => {
    const input = baseInput();
    // 2026 has brokerage + ira contributions (50k) and no distributions; add one.
    input.years = structuredClone(input.years);
    const y2026 = input.years.find((y) => y.year === 2026)!;
    y2026.accountLedgers.brokerage.distributions = 60_000;

    const d = buildPortfolioActivityDrillData(input);
    const i = d.chartSpec!.xAxis.domain.indexOf(2026);
    const additions = d.chartSpec!.stacks.find((s) => s.seriesId === "additions")!;
    const distributions = d.chartSpec!.stacks.find((s) => s.seriesId === "distributions")!;
    const net = d.chartSpec!.lines.find((l) => l.seriesId === "net")!;
    expect(additions.values[i]).toBe(50_000);
    expect(distributions.values[i]).toBe(-60_000); // negated for diverging render
    expect(net.values[i]).toBe(-10_000);           // 50_000 - 60_000
  });
});
