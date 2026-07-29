import { describe, it, expect } from "vitest";
import { band, BAND_CENTERS, computeProfile } from "../scoring";
import { RISK_LEVELS } from "@/lib/risk-levels";

describe("band", () => {
  it("round-trips every band center back to its own rung", () => {
    for (const level of RISK_LEVELS) {
      expect(band(BAND_CENTERS[level])).toBe(level);
    }
  });

  it("places boundaries on the lower rung's exclusive edge", () => {
    expect(band(0)).toBe("conservative");
    expect(band(19)).toBe("conservative");
    expect(band(20)).toBe("moderately_conservative");
    expect(band(59)).toBe("moderate");
    expect(band(60)).toBe("moderately_aggressive");
    expect(band(100)).toBe("aggressive");
  });
});

describe("computeProfile", () => {
  it("takes the lower of tolerance and capacity", () => {
    const r = computeProfile({ toleranceScore: 90, capacityScore: 25, environmentAdj: 0 });
    expect(r.compositeScore).toBe(25);
    expect(r.compositeLevel).toBe("moderately_conservative");
    expect(r.bindingConstraint).toBe("capacity");
  });

  it("reports tolerance as binding when it is the lower ceiling", () => {
    const r = computeProfile({ toleranceScore: 30, capacityScore: 80, environmentAdj: 0 });
    expect(r.compositeScore).toBe(30);
    expect(r.bindingConstraint).toBe("tolerance");
  });

  it("never lets environment breach the capacity ceiling", () => {
    const r = computeProfile({ toleranceScore: 90, capacityScore: 25, environmentAdj: 25 });
    expect(r.compositeScore).toBe(25);
    expect(r.bindingConstraint).toBe("capacity");
  });

  it("lets environment lower the profile freely", () => {
    const r = computeProfile({ toleranceScore: 60, capacityScore: 80, environmentAdj: -25 });
    expect(r.compositeScore).toBe(35);
    expect(r.bindingConstraint).toBe("tolerance");
  });

  it("clamps adjusted tolerance to 0..100 before the ceiling applies", () => {
    expect(computeProfile({ toleranceScore: 5, capacityScore: 80, environmentAdj: -25 }).compositeScore).toBe(0);
    expect(computeProfile({ toleranceScore: 95, capacityScore: 100, environmentAdj: 25 }).compositeScore).toBe(100);
  });

  it("returns a provisional tolerance-only profile when capacity is null", () => {
    const r = computeProfile({ toleranceScore: 70, capacityScore: null, environmentAdj: 0 });
    expect(r.compositeScore).toBe(70);
    expect(r.compositeLevel).toBe("moderately_aggressive");
    expect(r.bindingConstraint).toBe("none");
    expect(r.provisional).toBe(true);
  });

  it("returns no profile when tolerance is null, even with capacity present", () => {
    const r = computeProfile({ toleranceScore: null, capacityScore: 62, environmentAdj: 0 });
    expect(r.compositeScore).toBeNull();
    expect(r.compositeLevel).toBeNull();
    expect(r.bindingConstraint).toBe("none");
  });
});
