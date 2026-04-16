import { describe, it, expect } from "vitest";
import { calcCapGainsTax } from "../capGains";
import type { CapGainsTier } from "../types";

const MFJ_2026: CapGainsTier = { zeroPctTop: 99200, fifteenPctTop: 615900 };

describe("calcCapGainsTax", () => {
  it("returns 0 when no cap gains", () => {
    expect(calcCapGainsTax(0, 50000, MFJ_2026)).toBe(0);
  });

  it("taxes all cap gains at 0% when stacked income stays below 0% top", () => {
    expect(calcCapGainsTax(30000, 50000, MFJ_2026)).toBe(0);
  });

  it("taxes part at 0%, part at 15% when crossing first boundary", () => {
    // Ordinary 50000, LTCG 100000 → top 150000
    // 0%: 99200-50000=49200. 15%: 100000-49200=50800. Tax: 50800*0.15=7620
    expect(calcCapGainsTax(100000, 50000, MFJ_2026)).toBeCloseTo(7620, 2);
  });

  it("taxes all at 15% when ordinary already above 0% top", () => {
    expect(calcCapGainsTax(50000, 200000, MFJ_2026)).toBeCloseTo(7500, 2);
  });

  it("taxes part at 15%, part at 20% when crossing second boundary", () => {
    // Ordinary 500000, LTCG 200000 → top 700000
    // 15%: 615900-500000=115900, 20%: 200000-115900=84100
    // Tax: 115900*0.15 + 84100*0.20 = 17385+16820 = 34205
    expect(calcCapGainsTax(200000, 500000, MFJ_2026)).toBeCloseTo(34205, 2);
  });

  it("taxes everything at 20% when ordinary already above 15% top", () => {
    expect(calcCapGainsTax(50000, 700000, MFJ_2026)).toBeCloseTo(10000, 2);
  });
});
