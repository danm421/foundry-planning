import { describe, it, expect } from "vitest";
import { calcAmtTentative, calcAmtAdditional } from "../amt";

const PARAMS_2026_MFJ = {
  amtExemption: 140200,
  amtBreakpoint2628: 244500,
  amtPhaseoutStart: 1000000,
};

describe("calcAmtTentative", () => {
  it("returns 0 when AMTI is below exemption", () => {
    expect(calcAmtTentative(100000, PARAMS_2026_MFJ)).toBe(0);
  });

  it("applies 26% to taxable AMTI under breakpoint", () => {
    // AMTI 200000, exempt 140200, taxable 59800 * 26% = 15548
    expect(calcAmtTentative(200000, PARAMS_2026_MFJ)).toBeCloseTo(15548, 2);
  });

  it("applies 26%/28% split when taxable AMTI crosses breakpoint", () => {
    // AMTI 500000, taxable 359800
    // 244500 * 26% + (359800-244500) * 28% = 63570 + 32284 = 95854
    expect(calcAmtTentative(500000, PARAMS_2026_MFJ)).toBeCloseTo(95854, 2);
  });

  it("phases out exemption above $1M MFJ at 25%", () => {
    // AMTI 1200000 → phaseout (1200000-1000000)*0.25=50000 → exempt=90200
    // Taxable 1109800: 244500*0.26 + (1109800-244500)*0.28 = 63570 + 242284 = 305854
    expect(calcAmtTentative(1200000, PARAMS_2026_MFJ)).toBeCloseTo(305854, 2);
  });

  it("fully phases out exemption when AMTI very high", () => {
    // AMTI 2000000, exempt 0, taxable 2000000
    // 244500 * 26% + (2000000-244500) * 28% = 63570 + 491540 = 555110
    expect(calcAmtTentative(2000000, PARAMS_2026_MFJ)).toBeCloseTo(555110, 2);
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
