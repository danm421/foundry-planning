import { describe, it, expect } from "vitest";
import { hashBattery } from "../hash";
import type { InsightsBattery } from "../battery";

const sample = (over: Partial<InsightsBattery> = {}): InsightsBattery =>
  ({
    clientName: "Cooper Household",
    kpis: { netWorth: 2_000_000, liquidPortfolio: 1_200_000, yearsToRetirement: 5, mcSuccessRate: 0.9, fundingScore: 1.2 },
    retirementPeople: [{ label: "Cooper", currentAge: 60, retirementAge: 65, retirementYear: 2031 }],
    risk: { currentPct: 78, requiredPct: 45, capacityPct: 60, capacityScore: 60, verdict: "over_risked" },
    signals: [],
    mcBands: null,
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
  // Signals ARE staleness: a new RTQ, a newly uploaded return, a reassigned
  // portfolio or a closed task all change the ordered signal list, and the
  // cached AI profile must be regenerated rather than served off the old hash.
  it("changes when the signal list changes", () => {
    expect(hashBattery(sample())).not.toBe(
      hashBattery(
        sample({
          signals: [
            {
              id: "risk.review_due",
              domain: "risk",
              severity: "watch",
              title: "Risk review is due",
              detail: "The risk tolerance questionnaire is over two years old.",
              numbers: { daysSinceConfirmed: 900 },
              href: null,
              estimatedImpact: null,
            },
          ],
        }),
      ),
    );
  });

  // mcBands is interpolated into the AI prompt (the ending-portfolio percentile
  // spread) but is not reflected in `successRate` alone: a Monte Carlo re-run
  // can shift p5/p50/p95 without moving the pass/fail rate. Without mcBands in
  // the hash material, that re-run would report `stale: false` while the
  // cached profile keeps quoting the old percentiles.
  it("changes when the MC ending-percentile bands change", () => {
    expect(hashBattery(sample({ mcBands: { p5: 500_000, p50: 1_500_000, p95: 3_000_000 } }))).not.toBe(
      hashBattery(sample({ mcBands: { p5: 600_000, p50: 1_500_000, p95: 3_000_000 } })),
    );
  });

  // Editing a retirement age must invalidate the cached profile, or the AI prose
  // keeps quoting the old retirement year after the advisor corrects the plan.
  it("changes when a retirement age changes", () => {
    expect(hashBattery(sample())).not.toBe(
      hashBattery(
        sample({
          retirementPeople: [
            { label: "Cooper", currentAge: 60, retirementAge: 62, retirementYear: 2028 },
          ],
        }),
      ),
    );
  });
});
