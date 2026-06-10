import { describe, it, expect } from "vitest";
import { calcAmtTentative, calcAmtAdditional } from "../amt";

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
    // AMTI 500000, taxable 359800
    // 244500 * 26% + (359800-244500) * 28% = 63570 + 100884 = 164454
    // (No phase-out at AMTI=500k; exempt stays full.)
    expect(calcAmtTentative(500000, PARAMS_2026_MFJ, OBBBA)).toBeCloseTo(
      244500 * 0.26 + (500000 - 140200 - 244500) * 0.28,
      2,
    );
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
    // ltcg 50000, ordinaryAmti = 89800 - 50000 = 39800.
    //
    // Buggy floor = ordinaryAmti 39800 < zeroPctTop 99200 → stack top
    //   39800+50000 = 89800 < 99200 → all gains 0% → capGainsPortion 0.
    // Correct floor = regularOrdinaryBase 150000 > 99200 → all 50000 in 15%
    //   → 7500.
    //
    // Ordinary portion (26% on 39800) = 10348 in BOTH cases.
    const ordinaryPortion = 39800 * 0.26;

    const buggy = calcAmtTentative(230000, PARAMS_2026_MFJ, {
      year: 2026,
      ltcgPlusQdiv: 50000,
      capGainsBrackets: MFJ_CAP_GAINS,
    });
    // Without threading the regular base, gains fall into 0% → no cap-gains tax.
    expect(buggy).toBeCloseTo(ordinaryPortion, 2);

    const fixed = calcAmtTentative(230000, PARAMS_2026_MFJ, {
      year: 2026,
      ltcgPlusQdiv: 50000,
      capGainsBrackets: MFJ_CAP_GAINS,
      regularOrdinaryBase: 150000,
    });
    // Gains now correctly stacked above the 0% top → 50000 × 15% = 7500.
    expect(fixed).toBeCloseTo(ordinaryPortion + 7500, 2);
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
