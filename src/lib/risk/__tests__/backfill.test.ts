import { describe, it, expect } from "vitest";
import { planBackfill } from "../backfill";
import { computeProfile } from "../scoring";
import { RISK_LEVELS } from "@/lib/risk-levels";

describe("planBackfill", () => {
  it("skips clients with no risk tolerance set", () => {
    const out = planBackfill([
      { id: "a", firmId: "f", riskTolerance: null, updatedAt: new Date("2026-01-01") },
    ]);
    expect(out).toEqual([]);
  });

  it("preserves every existing rung exactly once capacity is still unknown", () => {
    const rows = RISK_LEVELS.map((level, i) => ({
      id: `c${i}`,
      firmId: "f",
      riskTolerance: level,
      updatedAt: new Date("2026-01-01"),
    }));
    for (const entry of planBackfill(rows)) {
      const result = computeProfile({
        toleranceScore: entry.patch.toleranceScore ?? null,
        capacityScore: null,
        environmentAdj: 0,
      });
      expect(result.compositeLevel).toBe(entry.originalLevel);
    }
  });

  it("stamps provenance as manual and dates it from the client record", () => {
    const [entry] = planBackfill([
      { id: "a", firmId: "f", riskTolerance: "moderate", updatedAt: new Date("2025-03-04T00:00:00Z") },
    ]);
    expect(entry.patch.toleranceScore).toBe(50);
    expect(entry.patch.toleranceSource).toBe("manual");
    expect(entry.patch.toleranceConfirmedAt).toEqual(new Date("2025-03-04T00:00:00Z"));
    expect(entry.patch.environmentAdj).toBe(0);
    expect(entry.patch.capacityScore).toBeUndefined();
  });
});
