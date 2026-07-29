import { describe, it, expect } from "vitest";
import { applyRtqPatch } from "@/lib/risk/apply-rtq";

describe("applyRtqPatch", () => {
  it("sets household tolerance from a primary sitting", () => {
    const p = applyRtqPatch({ subject: "primary", score: 72, existingSpouseScore: null });
    expect(p.toleranceScore).toBe(72);
    expect(p.spouseToleranceScore).toBeUndefined();
  });

  it("takes the lower of the pair when a spouse score exists", () => {
    const p = applyRtqPatch({ subject: "primary", score: 72, existingSpouseScore: 40 });
    expect(p.toleranceScore).toBe(40);
  });

  it("takes the lower of the pair when the spouse is the one being scored", () => {
    const p = applyRtqPatch({ subject: "spouse", score: 30, existingPrimaryScore: 80 });
    expect(p.spouseToleranceScore).toBe(30);
    expect(p.toleranceScore).toBe(30);
  });

  it("keeps the primary when the spouse scores higher", () => {
    const p = applyRtqPatch({ subject: "spouse", score: 90, existingPrimaryScore: 55 });
    expect(p.spouseToleranceScore).toBe(90);
    expect(p.toleranceScore).toBe(55);
  });
});
