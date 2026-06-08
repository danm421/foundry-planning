import { describe, it, expect } from "vitest";
import { buildEstateTaxResult } from "../estate-tax";

const baseInput = {
  year: 2030,
  deathOrder: 1 as const,
  deceased: "client" as const,
  gross: { lines: [], total: 1_000_000 },
  deductions: { maritalDeduction: 0, charitableDeduction: 0, estateAdminExpenses: 0 },
  adjustedTaxableGifts: 0,
  beaAtDeathYear: 15_000_000, // well above the estate → no federal tax
  dsueReceived: 0,
  residenceState: null,
  stateEstateTaxFallbackRate: 0,
  estateTaxDebits: [],
  creditorPayoffDebits: [],
  creditorPayoffResidual: 0,
};

describe("buildEstateTaxResult — probate cost", () => {
  it("subtracts probate cost from the taxable estate and adds it to expenses", () => {
    const r = buildEstateTaxResult({
      ...baseInput,
      probateCostRate: 0.05,
      probateEstate: 400_000,
    });
    expect(r.probateCost).toBe(20_000);
    expect(r.probateEstate).toBe(400_000);
    expect(r.probateCostRate).toBe(0.05);
    expect(r.taxableEstate).toBe(980_000);
    expect(r.totalTaxesAndExpenses).toBe(20_000);
  });

  it("is a no-op when probate inputs are omitted", () => {
    const r = buildEstateTaxResult(baseInput);
    expect(r.probateCost).toBe(0);
    expect(r.taxableEstate).toBe(1_000_000);
    expect(r.totalTaxesAndExpenses).toBe(0);
  });
});
