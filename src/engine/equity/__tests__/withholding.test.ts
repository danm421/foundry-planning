import { describe, it, expect } from "vitest";
import { computeSellToCover } from "../withholding";

describe("computeSellToCover", () => {
  it("returns no cover when disabled", () => {
    expect(
      computeSellToCover({ taxableIncome: 10000, fmvAtYear: 100, shares: 100, sellToCover: false, withholdingRate: 0.25 }),
    ).toEqual({ coverShares: 0, proceeds: 0, retained: 100 });
  });

  it("returns no cover when the rate is 0", () => {
    expect(
      computeSellToCover({ taxableIncome: 10000, fmvAtYear: 100, shares: 100, sellToCover: true, withholdingRate: 0 }),
    ).toEqual({ coverShares: 0, proceeds: 0, retained: 100 });
  });

  it("returns no cover when fmv is 0 (no divide-by-zero)", () => {
    expect(
      computeSellToCover({ taxableIncome: 10000, fmvAtYear: 0, shares: 100, sellToCover: true, withholdingRate: 0.25 }),
    ).toEqual({ coverShares: 0, proceeds: 0, retained: 100 });
  });

  it("sheds withholding shares: income 10000 @ rate 0.25, fmv 100 → 25 shares", () => {
    const r = computeSellToCover({ taxableIncome: 10000, fmvAtYear: 100, shares: 100, sellToCover: true, withholdingRate: 0.25 });
    expect(r.coverShares).toBeCloseTo(25, 6);
    expect(r.proceeds).toBeCloseTo(2500, 6);
    expect(r.retained).toBeCloseTo(75, 6);
  });

  it("clamps cover shares to the shares available", () => {
    const r = computeSellToCover({ taxableIncome: 1_000_000, fmvAtYear: 100, shares: 100, sellToCover: true, withholdingRate: 0.9 });
    expect(r.coverShares).toBe(100);
    expect(r.retained).toBe(0);
    expect(r.proceeds).toBeCloseTo(10000, 6);
  });
});
