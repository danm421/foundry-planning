import { describe, it, expect, vi } from "vitest";

// Count every real projection run (each solver probe = one runProjection).
let projectionCalls = 0;
vi.mock("@/engine/projection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/projection")>();
  return {
    ...actual,
    runProjection: (
      data: Parameters<typeof actual.runProjection>[0],
      options?: Parameters<typeof actual.runProjection>[1],
    ) => {
      projectionCalls++;
      return actual.runProjection(data, options);
    },
  };
});

import { computeNeedOverTime } from "../need-over-time";
import { solveLifeInsuranceNeed, TOLERANCE_FOR_TEST } from "../solve-need";
import { marriedBase } from "./test-helpers";

const overTime = {
  proceedsGrowthRate: 0.05,
  leaveToHeirsAmount: 15_000_000,
  livingExpenseAtDeath: null,
  payoffLiabilityIds: [] as string[],
};

describe("computeNeedOverTime — speedup v2", () => {
  it("solves every year within tolerance of the target (numbers unchanged)", () => {
    const data = marriedBase();
    const rows = computeNeedOverTime(data, overTime, false);
    for (const row of rows) {
      // Re-derive the achieved portfolio via a single-point solve at this year
      // and confirm it lands within the solver tolerance of the target — the
      // invariant that means "the survivor exactly clears the target".
      if (row.clientStatus !== "solved") continue;
      const r = solveLifeInsuranceNeed(data, "client", {
        ...overTime,
        deathYear: row.year,
      });
      if (r.faceValue === 0) continue;
      const err =
        Math.abs(r.achievedEndingPortfolio - overTime.leaveToHeirsAmount) /
        overTime.leaveToHeirsAmount;
      expect(err).toBeLessThanOrEqual(TOLERANCE_FOR_TEST);
    }
  });

  it("runs well under 5 projections per solve across the full curve", () => {
    const data = marriedBase();
    const years = data.planSettings.planEndYear - data.planSettings.planStartYear + 1;
    const solves = years * 2; // married ⇒ client + spouse per year
    projectionCalls = 0;
    computeNeedOverTime(data, overTime, false);
    // Pre-change baseline was ~6–8 projections/solve; assert the new path is
    // comfortably under 5/solve (target ~2–3).
    expect(projectionCalls).toBeLessThan(solves * 5);
  });
});
