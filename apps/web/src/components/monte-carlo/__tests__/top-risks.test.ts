import { describe, it, expect } from "vitest";
import { computeTopRisks } from "../lib/top-risks";
import type { MonteCarloSummary } from "@foundry/engine";

function summaryWithYearTen(p5AtYearTen: number, startMedian: number): MonteCarloSummary {
  const byYear = Array.from({ length: 20 }, (_, i) => ({
    year: 2026 + i,
    age: { client: 60 + i },
    balance: {
      p5: i === 10 ? p5AtYearTen : 1_000_000,
      p20: 1_200_000,
      p50: i === 0 ? startMedian : 1_500_000,
      p80: 2_000_000,
      p95: 2_500_000,
      min: 0,
      max: 3_000_000,
    },
    cagrFromStart: null,
  }));
  return {
    requestedTrials: 1000,
    trialsRun: 1000,
    aborted: false,
    successRate: 0.88,
    failureRate: 0.12,
    ending: { p5: 100, p20: 500, p50: 1000, p80: 2000, p95: 3000, min: 0, max: 4000, mean: 1500 },
    byYear,
  };
}

describe("computeTopRisks", () => {
  it("flags High Inflation when plan inflation > 3.5%", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(1_000_000, 2_000_000),
      { client: { planEndAge: 90 } },
      { inflationRate: 0.04 },
    );
    expect(risks.map((r) => r.label)).toContain("High Inflation");
  });

  it("flags Early Bear Market when year-10 p5 < starting median", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(500_000, 2_000_000),
      { client: { planEndAge: 90 } },
      { inflationRate: 0.025 },
    );
    expect(risks.map((r) => r.label)).toContain("Early Bear Market");
  });

  it("flags Longevity when planEndAge > 95", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(1_000_000, 2_000_000),
      { client: { planEndAge: 100 } },
      { inflationRate: 0.025 },
    );
    expect(risks.map((r) => r.label)).toContain("Longevity");
  });

  it("returns an empty array when no heuristic fires", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(1_000_000, 500_000), // year-10 p5 > starting median
      { client: { planEndAge: 90 } },
      { inflationRate: 0.025 },
    );
    expect(risks).toEqual([]);
  });

  it("returns all three when all fire, in stable order", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(500_000, 2_000_000),
      { client: { planEndAge: 100 } },
      { inflationRate: 0.04 },
    );
    expect(risks.map((r) => r.label)).toEqual(["High Inflation", "Early Bear Market", "Longevity"]);
  });
});
