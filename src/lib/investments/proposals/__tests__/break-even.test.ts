import { describe, it, expect } from "vitest";
import { computeBreakEven } from "../break-even";

describe("computeBreakEven", () => {
  it("divides the tax cost by the annual benefit", () => {
    // 1M x (0.5% return gain + 0.3% fee saving) = $8,000/yr against $20,000 tax.
    const r = computeBreakEven({
      estimatedTax: 20_000,
      totalValue: 1_000_000,
      returnDelta: 0.005,
      feeSavingRate: 0.003,
    });
    expect(r.annualBenefit).toBeCloseTo(8_000, 6);
    expect(r.years).toBeCloseTo(2.5, 6);
    expect(r.verdict).toBe("recovered");
  });

  it("treats an unknown fee saving as zero benefit from fees", () => {
    const r = computeBreakEven({
      estimatedTax: 10_000,
      totalValue: 1_000_000,
      returnDelta: 0.005,
      feeSavingRate: null,
    });
    expect(r.annualBenefit).toBeCloseTo(5_000, 6);
  });

  it("refuses to report a break-even when the proposal is not better", () => {
    const r = computeBreakEven({
      estimatedTax: 20_000,
      totalValue: 1_000_000,
      returnDelta: -0.002,
      feeSavingRate: 0.001,
    });
    expect(r.verdict).toBe("no_benefit");
    expect(r.years).toBeNull();
  });

  it("says there is nothing to recover when no tax is due", () => {
    const r = computeBreakEven({
      estimatedTax: 0,
      totalValue: 1_000_000,
      returnDelta: 0.005,
      feeSavingRate: 0.003,
    });
    expect(r.verdict).toBe("no_tax_cost");
    expect(r.years).toBeNull();
  });

  it("caps an implausibly long recovery rather than printing false precision", () => {
    const r = computeBreakEven({
      estimatedTax: 200_000,
      totalValue: 1_000_000,
      returnDelta: 0.0002,
      feeSavingRate: null,
    });
    expect(r.verdict).toBe("beyond_horizon");
    expect(r.years).toBeGreaterThan(25);
  });

  it("prioritizes the tax guard when both tax and benefit are zero or negative", () => {
    // estimatedTax = 0, annualBenefit = 1M * (-0.002 + 0) = -2_000
    const r = computeBreakEven({
      estimatedTax: 0,
      totalValue: 1_000_000,
      returnDelta: -0.002,
      feeSavingRate: null,
    });
    expect(r.verdict).toBe("no_tax_cost");
    expect(r.years).toBeNull();
  });

  it("returns recovered at exactly 25 years", () => {
    // annualBenefit = 1M * 0.008 = 8_000, years = 200_000 / 8_000 = 25 exactly
    const r = computeBreakEven({
      estimatedTax: 200_000,
      totalValue: 1_000_000,
      returnDelta: 0.008,
      feeSavingRate: null,
    });
    expect(r.years).toBe(25);
    expect(r.verdict).toBe("recovered");
  });

  it("returns beyond_horizon just past 25 years", () => {
    // annualBenefit = 1M * 0.008 = 8_000, years = 200_001 / 8_000 = 25.000125
    const r = computeBreakEven({
      estimatedTax: 200_001,
      totalValue: 1_000_000,
      returnDelta: 0.008,
      feeSavingRate: null,
    });
    expect(r.verdict).toBe("beyond_horizon");
  });
});
