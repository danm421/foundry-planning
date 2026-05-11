import { describe, it, expect } from "vitest";
import { computeStateEstateTax } from "../compute";

describe("Connecticut — flat 12% above exemption + $15M combined cap", () => {
  it("flat 12% bracket fires above $15M exemption", () => {
    const r = computeStateEstateTax({
      state: "CT",
      deathYear: 2026,
      taxableEstate: 20_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.bracketLines).toHaveLength(1);
    expect(r.bracketLines[0].rate).toBe(0.12);
    expect(r.preCapTax).toBe(600_000);
    expect(r.cap).toMatchObject({ applied: false, cap: 15_000_000 });
    expect(r.stateEstateTax).toBe(600_000);
  });

  it("caps total tax at $15M for very large estates", () => {
    const r = computeStateEstateTax({
      state: "CT",
      deathYear: 2026,
      taxableEstate: 200_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.preCapTax).toBe(22_200_000);
    expect(r.cap?.applied).toBe(true);
    expect(r.cap?.reduction).toBe(7_200_000);
    expect(r.stateEstateTax).toBe(15_000_000);
    expect(r.notes.some(n => n.includes("cap"))).toBe(true);
  });
});

describe("Massachusetts — anti-cliff credit", () => {
  it("tax of $0 just below the $2M exemption", () => {
    const r = computeStateEstateTax({
      state: "MA",
      deathYear: 2026,
      taxableEstate: 1_999_999,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stateEstateTax).toBe(0);
    expect(r.antiCliffCreditApplied).toBe(true);
  });

  it("graduated brackets only apply to amount above $2M (not from $0)", () => {
    const r = computeStateEstateTax({
      state: "MA",
      deathYear: 2026,
      taxableEstate: 4_250_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.antiCliffCreditApplied).toBe(true);
    expect(r.stateEstateTax).toBeCloseTo(179_040, 0);
    expect(r.bracketLines).toHaveLength(4);
  });
});

describe("New York — 105% cliff", () => {
  it("just under 105% of exemption → only excess taxed (credit absorbs all tax below exemption)", () => {
    const r = computeStateEstateTax({
      state: "NY",
      deathYear: 2026,
      taxableEstate: 7_510_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.cliff?.applied).toBe(false);
  });

  it("above 105% of exemption → entire estate taxed (no exemption credit)", () => {
    const r = computeStateEstateTax({
      state: "NY",
      deathYear: 2026,
      taxableEstate: 8_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.cliff?.applied).toBe(true);
    expect(r.baseForTax).toBe(8_000_000);
    expect(r.stateEstateTax).toBeCloseTo(773_200, 0);
  });
});
