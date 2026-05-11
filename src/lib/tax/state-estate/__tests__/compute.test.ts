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
