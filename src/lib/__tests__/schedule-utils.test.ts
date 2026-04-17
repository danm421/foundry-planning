import { describe, it, expect } from "vitest";
import { fillFlat, fillGrowth, fillStep } from "../schedule-utils";

describe("fillFlat", () => {
  it("fills every year with the same amount", () => {
    const result = fillFlat(2030, 2033, 50000);
    expect(result).toEqual([
      { year: 2030, amount: 50000 },
      { year: 2031, amount: 50000 },
      { year: 2032, amount: 50000 },
      { year: 2033, amount: 50000 },
    ]);
  });

  it("handles single-year range", () => {
    const result = fillFlat(2030, 2030, 10000);
    expect(result).toEqual([{ year: 2030, amount: 10000 }]);
  });
});

describe("fillGrowth", () => {
  it("compounds from start amount at given rate", () => {
    const result = fillGrowth(2030, 2032, 100000, 0.03);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ year: 2030, amount: 100000 });
    expect(result[1].amount).toBeCloseTo(103000, 0);
    expect(result[2].amount).toBeCloseTo(106090, 0);
  });

  it("handles zero growth rate (same as flat)", () => {
    const result = fillGrowth(2030, 2032, 50000, 0);
    expect(result.every((r) => r.amount === 50000)).toBe(true);
  });
});

describe("fillStep", () => {
  it("fills step range with amount and zeros elsewhere", () => {
    const result = fillStep(2030, 2035, 2031, 2033, 25000);
    expect(result).toEqual([
      { year: 2030, amount: 0 },
      { year: 2031, amount: 25000 },
      { year: 2032, amount: 25000 },
      { year: 2033, amount: 25000 },
      { year: 2034, amount: 0 },
      { year: 2035, amount: 0 },
    ]);
  });

  it("fills entire range when step covers it", () => {
    const result = fillStep(2030, 2032, 2030, 2032, 10000);
    expect(result.every((r) => r.amount === 10000)).toBe(true);
  });
});
