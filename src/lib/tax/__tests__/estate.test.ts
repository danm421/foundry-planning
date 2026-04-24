import { describe, it, expect } from "vitest";
import {
  applyUnifiedRateSchedule,
  beaForYear,
  BEA_2026,
  UNIFIED_RATE_SCHEDULE,
} from "../estate";

describe("applyUnifiedRateSchedule", () => {
  it("returns 0 for zero or negative input", () => {
    expect(applyUnifiedRateSchedule(0)).toBe(0);
    expect(applyUnifiedRateSchedule(-100)).toBe(0);
  });

  it("computes tax at each bracket boundary", () => {
    expect(applyUnifiedRateSchedule(10_000)).toBeCloseTo(1_800, 2);
    expect(applyUnifiedRateSchedule(20_000)).toBeCloseTo(3_800, 2);
    expect(applyUnifiedRateSchedule(40_000)).toBeCloseTo(8_200, 2);
    expect(applyUnifiedRateSchedule(60_000)).toBeCloseTo(13_000, 2);
    expect(applyUnifiedRateSchedule(80_000)).toBeCloseTo(18_200, 2);
    expect(applyUnifiedRateSchedule(100_000)).toBeCloseTo(23_800, 2);
    expect(applyUnifiedRateSchedule(150_000)).toBeCloseTo(38_800, 2);
    expect(applyUnifiedRateSchedule(250_000)).toBeCloseTo(70_800, 2);
    expect(applyUnifiedRateSchedule(500_000)).toBeCloseTo(155_800, 2);
    expect(applyUnifiedRateSchedule(750_000)).toBeCloseTo(248_300, 2);
    expect(applyUnifiedRateSchedule(1_000_000)).toBeCloseTo(345_800, 2);
  });

  it("computes Form-706 reference values", () => {
    expect(applyUnifiedRateSchedule(15_000_000)).toBeCloseTo(5_945_800, 2);
    expect(applyUnifiedRateSchedule(14_050_000)).toBeCloseTo(5_565_800, 2);
  });

  it("mid-bracket linear interpolation: +$1M above $1M threshold", () => {
    expect(applyUnifiedRateSchedule(2_000_000)).toBeCloseTo(745_800, 2);
  });

  it("UNIFIED_RATE_SCHEDULE has 12 rows", () => {
    expect(UNIFIED_RATE_SCHEDULE.length).toBe(12);
    expect(UNIFIED_RATE_SCHEDULE[0]).toEqual({ over: 0, base: 0, rate: 0.18 });
    expect(UNIFIED_RATE_SCHEDULE[11]).toEqual({ over: 1_000_000, base: 345_800, rate: 0.40 });
  });
});

describe("beaForYear", () => {
  it("returns BEA_2026 for 2026 and earlier", () => {
    expect(beaForYear(2026, 0.03)).toBe(BEA_2026);
    expect(beaForYear(2025, 0.03)).toBe(BEA_2026);
    expect(beaForYear(2020, 0.05)).toBe(BEA_2026);
  });

  it("grows by taxInflationRate past 2026", () => {
    const expected2030 = 15_000_000 * Math.pow(1.03, 4);
    expect(beaForYear(2030, 0.03)).toBeCloseTo(expected2030, 2);
  });

  it("zero inflation rate holds BEA flat", () => {
    expect(beaForYear(2050, 0)).toBe(BEA_2026);
  });

  it("BEA_2026 is $15,000,000", () => {
    expect(BEA_2026).toBe(15_000_000);
  });
});
