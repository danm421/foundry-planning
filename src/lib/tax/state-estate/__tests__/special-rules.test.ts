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
