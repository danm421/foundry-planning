import { describe, it, expect } from "vitest";
import { accrueLockedEntityShare } from "../locked-shares";

describe("accrueLockedEntityShare", () => {
  it("year 0: lockedBoY = beginningValue × percent when no carry exists", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: undefined,
      ledger: { beginningValue: 1_000_000, growth: 50_000 },
      percent: 0.3,
    });
    expect(r.lockedBoY).toBeCloseTo(300_000, 6);
    expect(r.lockedGrowth).toBeCloseTo(15_000, 6); // 50_000 × 0.3
    expect(r.lockedEoY).toBeCloseTo(315_000, 6);
  });

  it("year N: lockedBoY = carried prior EoY (independent of household flows)", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: 315_000,
      ledger: { beginningValue: 700_000, growth: 35_000 }, // hypothetical post-withdrawal
      percent: 0.3,
    });
    expect(r.lockedBoY).toBeCloseTo(315_000, 6);
    expect(r.lockedGrowth).toBeCloseTo(10_500, 6); // 35_000 × 0.3 — entity gets share of growth
    expect(r.lockedEoY).toBeCloseTo(325_500, 6);
  });

  it("zero growth preserves the carried share exactly", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: 300_000,
      ledger: { beginningValue: 800_000, growth: 0 },
      percent: 0.3,
    });
    expect(r.lockedEoY).toBe(300_000);
  });
});
