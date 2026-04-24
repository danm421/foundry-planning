import { describe, it, expect } from "vitest";
import { resolveCashValueForYear } from "../life-insurance-schedule";
import type { LifeInsuranceCashValueScheduleRow } from "../types";

const schedule: LifeInsuranceCashValueScheduleRow[] = [
  { year: 2030, cashValue: 100_000 },
  { year: 2035, cashValue: 200_000 },
  { year: 2040, cashValue: 320_000 },
];

describe("resolveCashValueForYear", () => {
  it("returns the exact value when the year has a row", () => {
    expect(resolveCashValueForYear(schedule, 2035)).toBe(200_000);
  });

  it("linearly interpolates between two rows", () => {
    expect(resolveCashValueForYear(schedule, 2032)).toBeCloseTo(140_000, 2);
    expect(resolveCashValueForYear(schedule, 2033)).toBeCloseTo(160_000, 2);
  });

  it("flat-forwards past the last row", () => {
    expect(resolveCashValueForYear(schedule, 2045)).toBe(320_000);
    expect(resolveCashValueForYear(schedule, 2100)).toBe(320_000);
  });

  it("flat-backs before the first row", () => {
    expect(resolveCashValueForYear(schedule, 2025)).toBe(100_000);
    expect(resolveCashValueForYear(schedule, 2000)).toBe(100_000);
  });

  it("handles a single-row schedule", () => {
    const single = [{ year: 2030, cashValue: 500_000 }];
    expect(resolveCashValueForYear(single, 2029)).toBe(500_000);
    expect(resolveCashValueForYear(single, 2030)).toBe(500_000);
    expect(resolveCashValueForYear(single, 2031)).toBe(500_000);
  });

  it("throws on an empty schedule", () => {
    expect(() => resolveCashValueForYear([], 2030)).toThrow(
      /empty cash-value schedule/,
    );
  });

  it("is order-independent", () => {
    const shuffled = [
      { year: 2040, cashValue: 320_000 },
      { year: 2030, cashValue: 100_000 },
      { year: 2035, cashValue: 200_000 },
    ];
    expect(resolveCashValueForYear(shuffled, 2032)).toBeCloseTo(140_000, 2);
  });
});
