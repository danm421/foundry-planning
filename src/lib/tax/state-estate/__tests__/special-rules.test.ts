import { describe, it, expect } from "vitest";
import { computeStateEstateTax } from "../compute";
import { applyMaxCombinedCap } from "../special-rules";
import type { StateEstateTaxRule } from "../types";

describe("applyMaxCombinedCap — CT §12-391(g) combined estate+gift cap (F13)", () => {
  it("F13: CT cap applies to combined gift + estate tax", () => {
    // cap 15M, estate tax 10M, prior CT gift tax 8M → combined 18M capped to 15M,
    // so estate-tax reduction = 18M − 15M = 3M → finalTax 7M.
    const app = applyMaxCombinedCap(
      { capCombined: 15_000_000 } as StateEstateTaxRule,
      10_000_000,
      8_000_000,
    );
    expect(app.applied).toBe(true);
    expect(app.reduction).toBe(3_000_000);
    expect(app.finalTax).toBe(7_000_000);
  });

  it("backward compat: priorGiftTax defaults to 0 and combined ≤ cap → not applied", () => {
    const app = applyMaxCombinedCap(
      { capCombined: 15_000_000 } as StateEstateTaxRule,
      10_000_000,
    );
    expect(app.applied).toBe(false);
    expect(app.reduction).toBe(0);
    expect(app.finalTax).toBe(10_000_000); // === preCapTax, unchanged
  });

  it("floors estate-tax reduction at $0 when prior gift tax alone exceeds the cap", () => {
    // estate tax 2M, prior gift tax 20M → combined 22M, overage 7M > estate tax 2M.
    const app = applyMaxCombinedCap(
      { capCombined: 15_000_000 } as StateEstateTaxRule,
      2_000_000,
      20_000_000,
    );
    expect(app.applied).toBe(true);
    expect(app.finalTax).toBe(0);
  });
});

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

describe("Massachusetts — §2011 table less fixed $99,600 credit (MGL c.65C, Oct 2023)", () => {
  it("tax of $0 at/below the $1.94M credit-absorption point", () => {
    const r = computeStateEstateTax({
      state: "MA",
      deathYear: 2026,
      taxableEstate: 1_940_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    // §2011 table at $1.94M = $99,600 exactly; the fixed credit absorbs it entirely.
    expect(r.stateEstateTax).toBe(0);
    expect(r.creditReduction).toBe(99_600);
  });

  it("even exactly $2M owes $4,320 (table is on the whole estate, not the excess)", () => {
    const r = computeStateEstateTax({
      state: "MA",
      deathYear: 2026,
      taxableEstate: 2_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    // §2011 table at $2M = $103,920; minus $99,600 credit = $4,320.
    expect(r.stateEstateTax).toBeCloseTo(4_320, 0);
  });

  it("graduated table applies from $0 (not just the amount above $2M)", () => {
    const r = computeStateEstateTax({
      state: "MA",
      deathYear: 2026,
      taxableEstate: 4_250_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.creditReduction).toBe(99_600);
    // §2011 table at $4.25M = $314,320; minus $99,600 credit = $214,720.
    expect(r.stateEstateTax).toBeCloseTo(214_720, 0);
  });
});

describe("New York — 105% cliff phase-out band (NY Tax Law §952(c)(2))", () => {
  const ny = (taxableEstate: number) =>
    computeStateEstateTax({ state: "NY", deathYear: 2026, taxableEstate, adjustedTaxableGifts: 0, fallbackFlatRate: 0 });

  // 2026: exemption $7,350,000, 105% cliff $7,717,500.
  it("at the exemption → $0 (phase-out credit fully absorbs the tax)", () => {
    const r = ny(7_350_000);
    expect(r.cliff?.applied).toBe(false);
    expect(r.stateEstateTax).toBe(0);
  });

  it("inside the band → whole estate taxed less a linearly-phased credit", () => {
    const r = ny(7_500_000);
    expect(r.cliff?.applied).toBe(false);
    // Whole estate is the tax base, not just the excess over the exemption.
    expect(r.baseForTax).toBe(7_500_000);
    expect(r.amountOverExemption).toBe(7_500_000);
    // 705,200 full-table tax − 405,289.8 phased credit ≈ 299,910.20 (not the
    // old "tax only the excess" code's much smaller number).
    expect(r.stateEstateTax).toBeCloseTo(299_910.2, 0);
  });

  it("near the top of the band → credit nearly exhausted", () => {
    expect(ny(7_700_000).stateEstateTax).toBeCloseTo(699_790.48, 0);
  });

  it("above 105% of exemption → entire estate taxed (no credit)", () => {
    const r = ny(8_000_000);
    expect(r.cliff?.applied).toBe(true);
    expect(r.baseForTax).toBe(8_000_000);
    expect(r.stateEstateTax).toBeCloseTo(773_200, 0);
  });

  it("is continuous across the $7,717,500 cliff (no six-figure discontinuity)", () => {
    const atCliff = ny(7_717_500).stateEstateTax;     // top of band, credit phased to $0
    const justOver = ny(7_717_501).stateEstateTax;    // cliff applied, whole estate
    expect(atCliff).toBeCloseTo(734_780, 0);
    // The old code jumped ~$685k over $1 here; the corrected band ties out to within a dollar.
    expect(Math.abs(justOver - atCliff)).toBeLessThan(1);
  });
});
