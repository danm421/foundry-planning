import { describe, it, expect } from "vitest";
import { computeStateEstateTax } from "../compute";

describe("computeStateEstateTax — vanilla brackets", () => {
  it("Hawaii: taxable estate at $6,000,000 → tax of $51,000", () => {
    const r = computeStateEstateTax({
      state: "HI",
      deathYear: 2026,
      taxableEstate: 6_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.state).toBe("HI");
    expect(r.exemption).toBe(5_490_000);
    expect(r.amountOverExemption).toBe(510_000);
    expect(r.bracketLines).toHaveLength(1);
    expect(r.bracketLines[0]).toMatchObject({
      from: 5_490_000,
      to: 6_490_000,
      rate: 0.10,
      amountTaxed: 510_000,
      tax: 51_000,
    });
    expect(r.stateEstateTax).toBe(51_000);
  });

  it("Hawaii: returns zero when taxable estate is below exemption", () => {
    const r = computeStateEstateTax({
      state: "HI",
      deathYear: 2026,
      taxableEstate: 4_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.amountOverExemption).toBe(0);
    expect(r.bracketLines).toHaveLength(0);
    expect(r.stateEstateTax).toBe(0);
  });

  it("Oregon: $12,000,000 estate spans all 10 brackets", () => {
    const r = computeStateEstateTax({
      state: "OR",
      deathYear: 2026,
      taxableEstate: 12_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stateEstateTax).toBe(1_422_500);
    expect(r.bracketLines).toHaveLength(10);
  });
});

describe("computeStateEstateTax — fallback flat-rate path (back-compat)", () => {
  it("returns zero when state is null and fallback rate is zero", () => {
    const r = computeStateEstateTax({
      state: null,
      deathYear: 2026,
      taxableEstate: 5_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.fallbackUsed).toBe(false);
    expect(r.stateEstateTax).toBe(0);
    expect(r.bracketLines).toHaveLength(0);
  });

  it("applies flat fallback rate when state is null and rate is positive", () => {
    const r = computeStateEstateTax({
      state: null,
      deathYear: 2026,
      taxableEstate: 5_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0.08,
    });
    expect(r.fallbackUsed).toBe(true);
    expect(r.fallbackRate).toBe(0.08);
    expect(r.stateEstateTax).toBe(400_000);
    expect(r.notes[0]).toMatch(/8\.00%/);
  });
});

describe("computeStateEstateTax — gift addback", () => {
  it("Hawaii: addback adds federal taxable gifts to base, increasing bracket usage", () => {
    const r = computeStateEstateTax({
      state: "HI",
      deathYear: 2026,
      taxableEstate: 5_000_000,
      adjustedTaxableGifts: 2_000_000,
      fallbackFlatRate: 0,
    });
    expect(r.giftAddback).toBe(2_000_000);
    expect(r.baseForTax).toBe(7_000_000);
    expect(r.stateEstateTax).toBeCloseTo(156_100, 0);
  });

  it("Maryland: no addback rule → gifts ignored", () => {
    const r = computeStateEstateTax({
      state: "MD",
      deathYear: 2026,
      taxableEstate: 6_000_000,
      adjustedTaxableGifts: 5_000_000,
      fallbackFlatRate: 0,
    });
    expect(r.giftAddback).toBe(0);
    expect(r.baseForTax).toBe(6_000_000);
    expect(r.stateEstateTax).toBe(160_000);
  });
});
