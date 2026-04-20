import { describe, it, expect } from "vitest";
import { calcQbiDeduction } from "../qbi";

const PARAMS_2026_MFJ = {
  threshold: 405000,
  phaseInRange: 150000,
};

describe("calcQbiDeduction (simplified, no SSTB rules)", () => {
  it("returns 0 when no QBI", () => {
    expect(calcQbiDeduction({ qbi: 0, taxableIncomeBeforeQbi: 200000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBe(0);
  });

  it("returns full 20% when below threshold", () => {
    expect(calcQbiDeduction({ qbi: 100000, taxableIncomeBeforeQbi: 250000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBeCloseTo(20000, 2);
  });

  it("returns 0 above threshold + full phase-in range (v1 simplified)", () => {
    expect(calcQbiDeduction({ qbi: 200000, taxableIncomeBeforeQbi: 600000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBe(0);
  });

  it("linearly phases out within the phase-in range", () => {
    // TI 480000 → 75000 into 150000 range → 50% phase-out
    // Full 20000 × 0.5 = 10000
    expect(calcQbiDeduction({ qbi: 100000, taxableIncomeBeforeQbi: 480000, ltCapGainsAndQualDiv: 0, ...PARAMS_2026_MFJ })).toBeCloseTo(10000, 2);
  });

  it("caps deduction at 20% × (taxable income - LTCG/qualDiv)", () => {
    // TI 200000, LTCG 100000 → cap base 100000, cap 20000
    // Full QBI 200000 × 20% = 40000 — cap binds at 20000
    expect(calcQbiDeduction({ qbi: 200000, taxableIncomeBeforeQbi: 200000, ltCapGainsAndQualDiv: 100000, ...PARAMS_2026_MFJ })).toBeCloseTo(20000, 2);
  });
});
