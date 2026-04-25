import { describe, it, expect } from "vitest";
import { computeTrustTax } from "../compute-trust-tax";
import type { BracketTier } from "@/lib/tax/types";

// 2026 trust brackets from the workbook.
const trustIncome2026: BracketTier[] = [
  { from: 0,     to: 3300,  rate: 0.10 },
  { from: 3300,  to: 12000, rate: 0.24 },
  { from: 12000, to: 16250, rate: 0.35 },
  { from: 16250, to: null,  rate: 0.37 },
];
const trustCapGains2026: BracketTier[] = [
  { from: 0,     to: 3350,  rate: 0    },
  { from: 3350,  to: 16300, rate: 0.15 },
  { from: 16300, to: null,  rate: 0.20 },
];

describe("computeTrustTax", () => {
  it("taxes retained ordinary at compressed brackets", () => {
    const r = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 50_000,
      retainedDividends: 0,
      recognizedCapGains: 0,
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0,
    });
    // 3300*.10 + (12000-3300)*.24 + (16250-12000)*.35 + (50000-16250)*.37
    // = 330 + 2088 + 1487.5 + 12487.5 = 16,393
    expect(r.federalOrdinaryTax).toBeCloseTo(16_393, 0);
    expect(r.federalCapGainsTax).toBe(0);
  });

  it("applies NIIT 3.8% above threshold on ordinary + gains", () => {
    const r = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 50_000,
      retainedDividends: 0,
      recognizedCapGains: 10_000,
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0,
    });
    // NIIT base = 50000 + 10000 - 16250 = 43750; NIIT = 43750 * 0.038 = 1662.5
    expect(r.niit).toBeCloseTo(1662.5, 1);
  });

  it("applies compressed LTCG brackets", () => {
    const r = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 0,
      retainedDividends: 0,
      recognizedCapGains: 20_000,
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0,
    });
    // 3350*0 + (16300-3350)*.15 + (20000-16300)*.20 = 0 + 1942.5 + 740 = 2682.5
    expect(r.federalCapGainsTax).toBeCloseTo(2682.5, 1);
  });

  it("applies flat state rate to retained ordinary + gains (not NIIT base)", () => {
    const r = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 50_000,
      retainedDividends: 0,
      recognizedCapGains: 10_000,
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0.05,
    });
    expect(r.stateTax).toBeCloseTo((50_000 + 10_000) * 0.05, 1);
  });

  it("returns zero tax for zero-income trust", () => {
    const r = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 0,
      retainedDividends: 0,
      recognizedCapGains: 0,
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0.05,
    });
    expect(r.total).toBe(0);
  });

  it("sums all four tax components into total", () => {
    const r = computeTrustTax({
      entityId: "t1",
      retainedOrdinary: 50_000,
      retainedDividends: 5_000,
      recognizedCapGains: 10_000,
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0.05,
    });
    expect(r.total).toBeCloseTo(r.federalOrdinaryTax + r.federalCapGainsTax + r.niit + r.stateTax, 1);
  });
});
