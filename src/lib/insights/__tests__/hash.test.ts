import { describe, it, expect } from "vitest";
import { hashBattery } from "../hash";
import type { InsightsBattery } from "../battery";

const sample = (over: Partial<InsightsBattery> = {}): InsightsBattery =>
  ({
    clientName: "Cooper Household",
    kpis: { netWorth: 2_000_000, liquidPortfolio: 1_200_000, yearsToRetirement: 5, mcSuccessRate: 0.9, fundingScore: 1.2 },
    risk: { currentPct: 78, requiredPct: 45, capacityPct: 60, capacityScore: 60, verdict: "over_risked" },
    needsAttention: [],
    grounding: { goalsText: "Retire at 65", notesText: "Conservative in downturns", allocation: [{ group: "equities", pct: 0.78 }] },
    ...over,
  }) as InsightsBattery;

describe("hashBattery", () => {
  it("is stable for identical batteries", () => {
    expect(hashBattery(sample())).toBe(hashBattery(sample()));
  });
  it("changes when a material number changes", () => {
    expect(hashBattery(sample())).not.toBe(
      hashBattery(sample({ kpis: { ...sample().kpis, netWorth: 2_100_000 } })),
    );
  });
});
