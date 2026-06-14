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

describe("computeStateEstateTax — indexed exemption projection to death year (F16)", () => {
  // NY exemption is statutorily indexed (NY Tax Law §952); the rule hard-codes the
  // 2026 value of $7,350,000. A 2045 death is 19 years forward. At a 2.5% indexing
  // rate the exemption projects to 7,350,000 × 1.025^19 = $11,750,079, rounded to the
  // nearest $10k = $11,750,000. An $11,000,000 estate sits BELOW that projected
  // exemption (→ $0 NY tax) but ABOVE the frozen 2026 cliff threshold of $7,717,500
  // (= 7,350,000 × 1.05), which would otherwise fire the 105% cliff and tax the
  // whole estate. Asserting $0 proves the projection ran.
  it("F16: NY 2045 death, 2.5% indexing → estate under projected $11.75M exemption owes $0", () => {
    const r = computeStateEstateTax({
      state: "NY",
      deathYear: 2045,
      inflationRate: 0.025,
      taxableEstate: 11_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.exemption).toBe(11_750_000);     // projected, not the frozen $7.35M
    expect(r.exemptionYear).toBe(2045);        // reflects the death year, not 2026
    expect(r.baseForTax).toBe(11_000_000);
    expect(r.stateEstateTax).toBe(0);          // below projected exemption → no tax
  });

  it("F16: current-year NY death (no projection) is unchanged — frozen exemption still taxes $11M", () => {
    // deathYear == effectiveYear → 0 years forward → projection is a no-op. The same
    // $11M estate that owed $0 above now exceeds the frozen $7.35M exemption's 105%
    // cliff and is fully taxed, exactly as before F16.
    const r = computeStateEstateTax({
      state: "NY",
      deathYear: 2026,
      inflationRate: 0.025,
      taxableEstate: 11_000_000,
      adjustedTaxableGifts: 0,
      fallbackFlatRate: 0,
    });
    expect(r.exemption).toBe(7_350_000);
    expect(r.stateEstateTax).toBeGreaterThan(0);
  });
});

describe("computeStateEstateTax — gift addback lookback window (F5)", () => {
  // NY narrows the addback to gifts made within 3 years of death (NY Tax Law §954(a)(3)).
  const nyWithGift = (giftYear: number) =>
    computeStateEstateTax({
      state: "NY",
      deathYear: 2030,
      taxableEstate: 6_500_000,
      adjustedTaxableGifts: 1_000_000,
      adjustedTaxableGiftsByYear: [{ year: giftYear, amount: 1_000_000 }],
      fallbackFlatRate: 0,
    });

  it("a gift 5 years before death is outside the 3-yr window → not added back", () => {
    const r = nyWithGift(2025); // 2030 − 2025 = 5 > 3
    expect(r.giftAddback).toBe(0);
    expect(r.baseForTax).toBe(6_500_000); // stays below the $7.35M exemption
    expect(r.stateEstateTax).toBe(0);     // not the phantom tax the old "tax the excess" code produced
  });

  it("a gift 2 years before death is inside the window → added back (crosses into the band)", () => {
    const r = nyWithGift(2028); // 2030 − 2028 = 2 ≤ 3
    expect(r.giftAddback).toBe(1_000_000);
    expect(r.baseForTax).toBe(7_500_000);
    expect(r.stateEstateTax).toBeCloseTo(299_910.2, 0); // matches the $7.5M phase-out-band case
  });

  it("a gift exactly 3 years before death is within the window (boundary inclusive)", () => {
    expect(nyWithGift(2027).giftAddback).toBe(1_000_000); // 2030 − 2027 = 3 ≤ 3
  });

  it("Infinity-window states (CT) add back gifts regardless of age", () => {
    const r = computeStateEstateTax({
      state: "CT",
      deathYear: 2030,
      taxableEstate: 10_000_000,
      adjustedTaxableGifts: 3_000_000,
      adjustedTaxableGiftsByYear: [{ year: 1990, amount: 3_000_000 }], // 40 years before
      fallbackFlatRate: 0,
    });
    expect(r.giftAddback).toBe(3_000_000);
  });

  it("falls back to the full scalar when no per-year breakdown is supplied (back-compat)", () => {
    const r = computeStateEstateTax({
      state: "NY",
      deathYear: 2030,
      taxableEstate: 6_500_000,
      adjustedTaxableGifts: 1_000_000,
      fallbackFlatRate: 0,
    });
    expect(r.giftAddback).toBe(1_000_000);
  });
});
