import { describe, it, expect } from "vitest";
import { calcNiit } from "../niit";

describe("calcNiit", () => {
  it("returns 0 when MAGI is below threshold", () => {
    expect(calcNiit({ magi: 200000, investmentIncome: 50000, threshold: 250000, rate: 0.038 })).toBe(0);
  });

  it("returns 0 when investment income is 0 even above threshold", () => {
    expect(calcNiit({ magi: 500000, investmentIncome: 0, threshold: 250000, rate: 0.038 })).toBe(0);
  });

  it("taxes investment income when it is the lesser of the two", () => {
    // MAGI 300000, excess 50000, investment 30000 (lesser) → 30000 * 0.038 = 1140
    expect(calcNiit({ magi: 300000, investmentIncome: 30000, threshold: 250000, rate: 0.038 })).toBeCloseTo(1140, 2);
  });

  it("taxes excess MAGI when it is the lesser of the two", () => {
    // MAGI 280000, excess 30000, investment 100000 → 30000 * 0.038 = 1140
    expect(calcNiit({ magi: 280000, investmentIncome: 100000, threshold: 250000, rate: 0.038 })).toBeCloseTo(1140, 2);
  });

  it("applies to dividends/cap gains only when no earned income", () => {
    // MAGI 400000, investment 400000 → min(400000, 150000) * 0.038 = 5700
    expect(calcNiit({ magi: 400000, investmentIncome: 400000, threshold: 250000, rate: 0.038 })).toBeCloseTo(5700, 2);
  });
});
