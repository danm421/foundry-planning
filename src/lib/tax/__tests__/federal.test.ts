import { describe, it, expect } from "vitest";
import { calcFederalTax, calcMarginalRate } from "../federal";
import type { BracketTier } from "../types";

const MFJ_2026: BracketTier[] = [
  { from: 0,      to: 24800,   rate: 0.10 },
  { from: 24800,  to: 100800,  rate: 0.12 },
  { from: 100800, to: 211950,  rate: 0.22 },
  { from: 211950, to: 405000,  rate: 0.24 },
  { from: 405000, to: 510400,  rate: 0.32 },
  { from: 510400, to: 768700,  rate: 0.35 },
  { from: 768700, to: null,    rate: 0.37 },
];

describe("calcFederalTax", () => {
  it("returns 0 for zero income", () => {
    expect(calcFederalTax(0, MFJ_2026)).toBe(0);
  });

  it("returns 0 for negative income (no refund)", () => {
    expect(calcFederalTax(-1000, MFJ_2026)).toBe(0);
  });

  it("taxes income within first bracket at 10%", () => {
    expect(calcFederalTax(20000, MFJ_2026)).toBeCloseTo(2000, 2);
  });

  it("taxes income exactly at first bracket boundary", () => {
    // $24,800 = full first bracket ($24,800 × 10%) = $2,480
    expect(calcFederalTax(24800, MFJ_2026)).toBeCloseTo(2480, 2);
  });

  it("taxes income spanning first two brackets", () => {
    // 24800×0.10 + (50000-24800)×0.12 = 2480 + 3024 = 5504
    expect(calcFederalTax(50000, MFJ_2026)).toBeCloseTo(5504, 2);
  });

  it("taxes income in top bracket correctly", () => {
    // Cumulative through 768700 + (1000000-768700)×0.37
    // 24800×0.10 = 2480
    // (100800-24800)×0.12 = 9120
    // (211950-100800)×0.22 = 24453
    // (405000-211950)×0.24 = 46332
    // (510400-405000)×0.32 = 33728
    // (768700-510400)×0.35 = 90405
    // Subtotal = 206518
    // (1000000-768700)×0.37 = 85581
    // Total = 292099
    expect(calcFederalTax(1000000, MFJ_2026)).toBeCloseTo(292099, 2);
  });
});

describe("calcMarginalRate", () => {
  it("returns lowest rate for income in first bracket", () => {
    expect(calcMarginalRate(20000, MFJ_2026)).toBe(0.10);
  });

  it("returns correct rate at bracket boundary (boundary belongs to lower)", () => {
    // Exactly at top of 10% bracket — next dollar is taxed at 12%
    expect(calcMarginalRate(24800, MFJ_2026)).toBe(0.12);
  });

  it("returns top rate for income in top bracket", () => {
    expect(calcMarginalRate(2000000, MFJ_2026)).toBe(0.37);
  });
});
