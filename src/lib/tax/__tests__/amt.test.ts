import { describe, it, expect } from "vitest";
import { calcAmtTentative, calcAmtAdditional, amtApplies } from "../amt";

const PARAMS_2026_MFJ = {
  amtExemption: 140200,
  amtBreakpoint2628: 244500,
  amtPhaseoutStart: 1000000,
};

// Pre-OBBBA year — phase-out still at 25%.
const PRE_OBBBA = { year: 2025 };
// OBBBA year — phase-out at 50%.
const OBBBA = { year: 2026 };

describe("calcAmtTentative", () => {
  it("returns 0 when AMTI is below exemption", () => {
    expect(calcAmtTentative(100000, PARAMS_2026_MFJ, OBBBA)).toBe(0);
  });

  it("applies 26% to taxable AMTI under breakpoint", () => {
    // AMTI 200000, exempt 140200, taxable 59800 * 26% = 15548
    expect(calcAmtTentative(200000, PARAMS_2026_MFJ, OBBBA)).toBeCloseTo(15548, 2);
  });

  it("applies 26%/28% split when taxable AMTI crosses breakpoint", () => {
    // AMTI 500000, exempt 140200 (no phase-out at 500k) → taxable 359800.
    // The 28% rate applies ONLY to the slab above the breakpoint, not to the
    // whole base — the mistake this comment used to make, and the one an
    // engineer reading it would have been primed to repeat:
    //   244500 × 26%          =  63570
    //   (359800 − 244500) × 28% =  32284
    //                           = 95854
    // Asserted as a literal on purpose. The expression this used to assert
    // mirrored the implementation, so it agreed with the code by construction
    // and could not have caught a rate swap.
    expect(calcAmtTentative(500000, PARAMS_2026_MFJ, OBBBA)).toBeCloseTo(95_854, 2);
  });

  it("phases out exemption above $1M MFJ at 25% pre-OBBBA", () => {
    // AMTI 1200000 → phaseout (1200000-1000000)*0.25=50000 → exempt=90200
    // Taxable 1109800: 244500*0.26 + (1109800-244500)*0.28 = 63570 + 242284 = 305854
    expect(calcAmtTentative(1200000, PARAMS_2026_MFJ, PRE_OBBBA)).toBeCloseTo(305854, 2);
  });

  it("phases out exemption above $1M MFJ at 50% post-OBBBA (2026+)", () => {
    // AMTI 1200000 → phaseout (1200000-1000000)*0.50=100000 → exempt=40200
    // Taxable 1159800: 244500*0.26 + (1159800-244500)*0.28 = 63570 + 256284 = 319854
    expect(calcAmtTentative(1200000, PARAMS_2026_MFJ, OBBBA)).toBeCloseTo(319854, 2);
  });

  it("fully phases out exemption when AMTI very high", () => {
    // AMTI 2000000, exempt 0 under either rate, taxable 2000000
    // 244500 * 26% + (2000000-244500) * 28% = 63570 + 491540 = 555110
    expect(calcAmtTentative(2000000, PARAMS_2026_MFJ, OBBBA)).toBeCloseTo(555110, 2);
  });
});

describe("calcAmtTentative — Part III cap-gains stacking floor (Bug #19)", () => {
  // The 0/15/20% breakpoints are REGULAR taxable-income thresholds. Form 6251
  // Part III stacks the preferential amounts on the same regular ordinary base
  // used by the regular cap-gains tax — NOT on the post-exemption AMTI ordinary
  // portion. Stacking on the reduced (post-exemption) AMTI mis-places gains into
  // a too-low preferential bracket and understates TMT.
  const MFJ_CAP_GAINS = { zeroPctTop: 99200, fifteenPctTop: 615900 };

  it("stacks LTCG on the regular ordinary base, not on post-exemption AMTI", () => {
    // AMTI 230000, exemption 140200 → taxableAmti 89800.
    // ltcg 50000, ordinaryAmti = 89800 − 50000 = 39800.
    // Ordinary portion (26% on 39800) = 10348 under EITHER floor; only the
    // gains slice moves, which is what makes the floor observable.
    //
    // Correct floor — the REGULAR ordinary base of 150000, already above the
    // 99200 zero-percent top, so all 50000 of gain sits in the 15% band:
    //   10348 + 50000 × 15% = 17848.
    const correct = calcAmtTentative(230000, PARAMS_2026_MFJ, {
      year: 2026,
      ltcgPlusQdiv: 50000,
      capGainsBrackets: MFJ_CAP_GAINS,
      regularOrdinaryBase: 150000,
    });
    expect(correct).toBeCloseTo(17_848, 2);

    // Wrong floor — the post-exemption AMTI ordinary portion (39800). The stack
    // then tops out at 89800, under 99200, so every dollar of gain reads as 0%
    // and TMT is understated by the whole 7500. Both arms pass the floor
    // EXPLICITLY: what is asserted here is that the argument drives the answer,
    // not that some omitted-argument fallback is the behaviour we want.
    const wrongFloor = calcAmtTentative(230000, PARAMS_2026_MFJ, {
      year: 2026,
      ltcgPlusQdiv: 50000,
      capGainsBrackets: MFJ_CAP_GAINS,
      regularOrdinaryBase: 39800,
    });
    expect(wrongFloor).toBeCloseTo(10_348, 2);
  });

  it("taxes the AMT gains slice above the 15% breakpoint at 20%", () => {
    // Nothing anywhere reached the top preferential tier, so collapsing it to
    // 15% used to change no test. AMTI 900000 (below the 1M phase-out start),
    // 400000 of it long-term gain, regular ordinary base 500000.
    //   taxable AMTI 759800 → ordinary slice 359800
    //     ordinary: 244500 × 26% + 115300 × 28%        = 95854
    //   gains stacked 500000 → 900000 against 99200 / 615900:
    //     15%: (615900 − 500000) × 15%                 = 17385
    //     20%: (900000 − 615900) × 20%                 = 56820
    //   TMT = 170059.  At a flat 15% the answer would be 155854.
    expect(
      calcAmtTentative(900000, PARAMS_2026_MFJ, {
        year: 2026,
        ltcgPlusQdiv: 400000,
        capGainsBrackets: MFJ_CAP_GAINS,
        regularOrdinaryBase: 500000,
      }),
    ).toBeCloseTo(170_059, 2);
  });

  it("clamps the preferential slice to what survives the exemption", () => {
    // The gains handed in are the ones inside AMTI, but the exemption comes off
    // the base before Part III splits it — so the slice taxed at preferential
    // rates can never exceed the post-exemption base (Form 6251). Removing that
    // clamp used to change no test at all.
    //   AMTI 200000 − exemption 140200 = 59800 of taxable AMTI, against 150000
    //   of gains. Clamped: the whole 59800 is the gains slice, ordinary 0,
    //   stacked 50000 → 109800 → (109800 − 99200) × 15% = 1590.
    //   Unclamped, all 150000 would be taxed preferentially → 15120, nearly ten
    //   times the tax, on a base that does not exist.
    expect(
      calcAmtTentative(200000, PARAMS_2026_MFJ, {
        year: 2026,
        ltcgPlusQdiv: 150000,
        capGainsBrackets: MFJ_CAP_GAINS,
        regularOrdinaryBase: 50000,
      }),
    ).toBeCloseTo(1_590, 2);
  });
});

describe("calcAmtAdditional", () => {
  it("returns 0 when tentative AMT is less than regular tax", () => {
    expect(calcAmtAdditional(15548, 30000)).toBe(0);
  });

  it("returns the difference when AMT exceeds regular", () => {
    expect(calcAmtAdditional(50000, 30000)).toBe(20000);
  });
});

describe("amtApplies — the one gate every AMT surface reads", () => {
  it("is false at zero", () => {
    expect(amtApplies(0)).toBe(false);
  });

  it("is false for a sub-dollar excess (F37: 40 cents printed '$0 — AMT applies')", () => {
    expect(amtApplies(0.4)).toBe(false);
    expect(amtApplies(0.99)).toBe(false);
  });

  it("is true from a whole dollar up", () => {
    expect(amtApplies(1)).toBe(true);
    expect(amtApplies(196_899)).toBe(true);
  });

  it("treats a missing figure as no AMT rather than throwing", () => {
    expect(amtApplies(undefined)).toBe(false);
    expect(amtApplies(null)).toBe(false);
  });

  it("is false for a negative figure", () => {
    expect(amtApplies(-5)).toBe(false);
  });
});
