import { describe, it, expect } from "vitest";
import type { TrendPoint } from "@contracts";
import { formatPct, pctChange } from "./trend";

function pt(netWorth: number, date = "2026-01-01"): TrendPoint {
  return { date, netWorth };
}

describe("pctChange", () => {
  it("returns null for an empty series", () => {
    expect(pctChange([])).toBeNull();
  });

  it("returns null for a single-point series", () => {
    expect(pctChange([pt(100)])).toBeNull();
  });

  it("computes the fractional change from first to last", () => {
    expect(pctChange([pt(100), pt(112)])).toBeCloseTo(0.12, 9);
  });

  it("returns null when the first value is 0", () => {
    expect(pctChange([pt(0), pt(50)])).toBeNull();
  });

  it("uses the absolute value of a negative first value", () => {
    // first = -100, last = 50 → (50 - -100) / |-100| = 150/100 = 1.5
    expect(pctChange([pt(-100), pt(50)])).toBeCloseTo(1.5, 9);
  });
});

describe("formatPct", () => {
  it("formats a positive change with a leading plus", () => {
    expect(formatPct(0.032)).toBe("+3.2%");
  });

  it("formats a negative change with a proper minus sign", () => {
    expect(formatPct(-0.014)).toBe("−1.4%");
  });

  it("treats zero as positive", () => {
    expect(formatPct(0)).toBe("+0.0%");
  });
});
