import { describe, it, expect } from "vitest";
import { accrueLockedEntityShare } from "../locked-shares";

describe("accrueLockedEntityShare", () => {
  it("year 0: lockedBoY = beginningValue × percent when no carry exists", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: undefined,
      ledger: { beginningValue: 1_000_000, growth: 50_000, endingValue: 1_050_000 },
      percent: 0.3,
    });
    expect(r.lockedBoY).toBeCloseTo(300_000, 6);
    expect(r.lockedGrowth).toBeCloseTo(15_000, 6); // 50_000 × 0.3
    expect(r.lockedEoY).toBeCloseTo(315_000, 6);
  });

  it("year N: lockedBoY = carried prior EoY (independent of household flows)", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: 315_000,
      ledger: { beginningValue: 700_000, growth: 35_000, endingValue: 735_000 }, // hypothetical post-withdrawal
      percent: 0.3,
    });
    expect(r.lockedBoY).toBeCloseTo(315_000, 6);
    expect(r.lockedGrowth).toBeCloseTo(10_500, 6); // 35_000 × 0.3 — entity gets share of growth
    expect(r.lockedEoY).toBeCloseTo(325_500, 6);
  });

  it("carry of zero is honored as a real zero, not the year-0 fallback", () => {
    // Distinguishes `0` (entity share fully drained from a prior year) from
    // `undefined` (no carry yet). `??` is correct here; `||` would conflate.
    const r = accrueLockedEntityShare({
      carriedBoY: 0,
      ledger: { beginningValue: 500_000, growth: 10_000, endingValue: 510_000 },
      percent: 0.3,
    });
    expect(r.lockedBoY).toBe(0);
    expect(r.lockedGrowth).toBeCloseTo(3_000, 6); // growth still accrues
    expect(r.lockedEoY).toBeCloseTo(3_000, 6);
  });

  it("zero growth preserves the carried share exactly", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: 300_000,
      ledger: { beginningValue: 800_000, growth: 0, endingValue: 800_000 },
      percent: 0.3,
    });
    expect(r.lockedEoY).toBe(300_000);
  });

  it("F3: lockedEoY clamps at the account's ending balance when outflows ate into the locked slice", () => {
    // Carry 500k on an account whose balance fell to 420k — the entity's
    // reported slice can never exceed what the account actually holds.
    const r = accrueLockedEntityShare({
      carriedBoY: 500_000,
      ledger: { beginningValue: 800_000, growth: 0, endingValue: 420_000 },
      percent: 0.5,
    });
    expect(r.lockedBoY).toBe(500_000); // BoY continuity untouched
    expect(r.lockedEoY).toBe(420_000); // clamped
  });

  it("F3: a fully drained account carries a locked share of exactly 0", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: 500_000,
      ledger: { beginningValue: 500_000, growth: 25_000, endingValue: 0 },
      percent: 0.5,
    });
    expect(r.lockedEoY).toBe(0);
  });

  it("F3: a negative ending balance clamps to 0, never negative", () => {
    const r = accrueLockedEntityShare({
      carriedBoY: 100_000,
      ledger: { beginningValue: 200_000, growth: 0, endingValue: -50_000 },
      percent: 0.5,
    });
    expect(r.lockedEoY).toBe(0);
  });
});
