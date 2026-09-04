import { describe, it, expect } from "vitest";
import { irmaaCapCeiling } from "../medicare";
import type { IrmaaTier } from "../types";

// 2026 MFJ, from data/medicare-irmaa-2024-2026.json.
const MFJ_2026: IrmaaTier[] = [
  { tier: 1, magiLowerBound: 218000, magiUpperBound: 274000, partBSurcharge: 974.4, partDSurcharge: 174.0 },
  { tier: 2, magiLowerBound: 274000, magiUpperBound: 342000, partBSurcharge: 2434.8, partDSurcharge: 450.0 },
  { tier: 3, magiLowerBound: 342000, magiUpperBound: 410000, partBSurcharge: 3895.2, partDSurcharge: 724.8 },
  { tier: 4, magiLowerBound: 410000, magiUpperBound: 750000, partBSurcharge: 5355.6, partDSurcharge: 999.6 },
  { tier: 5, magiLowerBound: 750000, magiUpperBound: null, partBSurcharge: 5844.0, partDSurcharge: 1092.0 },
];

describe("irmaaCapCeiling", () => {
  it("tier 0 ceiling is the tier-1 entry threshold EXACTLY", () => {
    // IRMAA bounds are lower-EXCLUSIVE (20 CFR 418.2120): MAGI of exactly
    // 218,000 is surcharge-free, so the ceiling is 218000 — NOT 217999.
    // This is the mirror image of fillUpBracketCeiling's $1 backoff, which
    // subtracts a dollar because TAX brackets are lower-INCLUSIVE.
    expect(irmaaCapCeiling(MFJ_2026, 0)).toBe(218000);
  });

  it("tier N ceiling is that tier's upper bound", () => {
    expect(irmaaCapCeiling(MFJ_2026, 1)).toBe(274000);
    expect(irmaaCapCeiling(MFJ_2026, 4)).toBe(750000);
  });

  it("returns null for the unbounded top tier", () => {
    expect(irmaaCapCeiling(MFJ_2026, 5)).toBeNull();
  });

  it("returns null for a tier that isn't in the table", () => {
    expect(irmaaCapCeiling(MFJ_2026, 9)).toBeNull();
    expect(irmaaCapCeiling([], 0)).toBeNull();
  });
});
