import { describe, it, expect } from "vitest";
import { buildMonteCarloData } from "../view-model";
import type { MonteCarloReportPayload } from "../view-model";
import type { BuildDataContext } from "@/components/presentations/registry";

const payload: MonteCarloReportPayload = {
  summary: {
    requestedTrials: 1000, trialsRun: 1000, aborted: false,
    successRate: 0.84, failureRate: 0.16,
    ending: { p5: 100, p20: 300, p50: 600, p80: 900, p95: 1200, min: 0, max: 1500, mean: 620 },
    byYear: [
      { year: 2026, age: { client: 65 }, balance: { p5: 90, p20: 280, p50: 560, p80: 840, p95: 1100, min: 0, max: 1200 }, cagrFromStart: { p5: -0.02, p20: 0.01, p50: 0.05, p80: 0.08, p95: 0.11 } },
    ],
  },
  histogram: {
    bins: [{ min: 0, max: 1000, count: 1000 }],
    p5: 100, p25: 400, p50: 600, p75: 850, p95: 1200,
    belowDomainCount: 0, aboveDomainCount: 0,
    sd: { mean: 620, stdDev: 250, minus2: 120, minus1: 370, plus1: 870, plus2: 1120, countWithin1: 700, countWithin2: 950, countBelowMinus2: 10, countAbovePlus2: 40 },
  },
  successRates: [0.95],
  deterministic: [555],
};

// Minimal ctx — only the fields the view-model reads.
function ctx(extra: Partial<BuildDataContext>): BuildDataContext {
  return {
    years: [],
    projection: {} as never,
    clientData: { client: { retirementAge: 65 } } as never,
    scenarioLabel: "Base Case",
    clientName: "Jane Doe",
    spouseName: null,
    spouseLastName: null,
    firmName: "Acme",
    firmTagline: null,
    firmLogoDataUrl: null,
    accentColor: "#b87f1f",
    reportDate: "May 29, 2026",
    monteCarlo: payload,
    ...extra,
  };
}

describe("buildMonteCarloData", () => {
  it("flags unavailable when no payload was injected", () => {
    const data = buildMonteCarloData(ctx({ monteCarlo: null }), { highlight: "fan" });
    expect(data.available).toBe(false);
  });

  it("builds KPIs, table, three specs, and respects the highlight", () => {
    const data = buildMonteCarloData(ctx({}), { highlight: "histogram" });
    expect(data.available).toBe(true);
    expect(data.heroKind).toBe("histogram");
    expect(data.kpis.map((k) => k.label)).toContain("Probability of success");
    expect(data.kpis.find((k) => k.label === "Probability of success")?.value).toBe("84%");
    expect(data.table.rows).toHaveLength(1);
    expect(data.table.rows[0].cells.p50).toBe(560);
    expect(data.fan.median).toEqual([560]);
    expect(data.histogram.bins).toHaveLength(1);
    expect(data.success.bars).toHaveLength(1);
  });
});
