import { describe, it, expect } from "vitest";
import {
  ltcInflationFactor,
  ltcMonthlyFromUnit,
  ltcStandaloneMonthly,
  ltcStandalonePool,
  ltcRiderMonthly,
  ltcRiderCap,
  ltcPremiumExpenseId,
  ltcBenefitIncomeId,
} from "../ltc-benefits";

describe("ltcInflationFactor", () => {
  const p = (inflationRider: "none" | "simple" | "compound") => ({ inflationRider, inflationRate: 0.03, issueYear: 2016 });
  it("grows from the ISSUE year, simple or compound, and not at all with none", () => {
    expect(ltcInflationFactor(p("none"), 2026)).toBe(1);
    expect(ltcInflationFactor(p("simple"), 2026)).toBeCloseTo(1.3, 10);
    expect(ltcInflationFactor(p("compound"), 2026)).toBeCloseTo(1.343916379, 8);
  });
  it("is 1 in or before the issue year", () => {
    expect(ltcInflationFactor(p("compound"), 2016)).toBe(1);
    expect(ltcInflationFactor(p("compound"), 2010)).toBe(1);
  });
});

describe("ltcMonthlyFromUnit", () => {
  it("turns a daily benefit into a monthly one as day × 365 / 12", () => {
    expect(ltcMonthlyFromUnit(200, "day")).toBeCloseTo(6083.333, 3);
    expect(ltcMonthlyFromUnit(6000, "month")).toBe(6000);
  });
});

describe("shared policy math", () => {
  const standalone = {
    benefitAmount: 6000,
    benefitUnit: "month" as const,
    inflationRider: "compound" as const,
    inflationRate: 0.03,
    issueYear: 2026,
    benefitPeriodMode: "years" as const,
    benefitPeriodYears: 3,
  };

  it("a traditional policy's monthly benefit and pool grow from the issue year", () => {
    expect(ltcStandaloneMonthly(standalone, 2026)).toBe(6000);
    // 6,000 × 1.03² = 6,000 × 1.0609 = 6,365.40
    expect(ltcStandaloneMonthly(standalone, 2028)).toBeCloseTo(6365.4, 6);
    // 6,000 × 12 × 3 = 216,000; two years on, × 1.0609 = 229,154.40
    expect(ltcStandalonePool(standalone, 2026)).toBe(216_000);
    expect(ltcStandalonePool(standalone, 2028)).toBeCloseTo(229_154.4, 6);
  });

  it("a lifetime policy, or one with no benefit period entered, has no pool", () => {
    expect(ltcStandalonePool({ ...standalone, benefitPeriodMode: "lifetime" }, 2026)).toBeNull();
    expect(ltcStandalonePool({ ...standalone, benefitPeriodYears: null }, 2026)).toBeNull();
  });

  const rider = {
    riderBenefitMode: "pct_of_face" as const,
    riderMonthlyPct: 0.02,
    benefitAmount: 0,
    benefitUnit: "month" as const,
    inflationRider: "none" as const,
    inflationRate: 0.03,
    issueYear: 2026,
    riderMaxPct: 1,
    residualDeathBenefit: 0,
  };

  it("a rider's monthly limit is a share of the face or a fixed amount, grown by its inflation rider", () => {
    // 2% × 500,000 = 10,000
    expect(ltcRiderMonthly(rider, 500_000, 2030)).toBe(10_000);
    // $300/day × 365 / 12 = 9,125
    expect(
      ltcRiderMonthly({ ...rider, riderBenefitMode: "fixed", benefitAmount: 300, benefitUnit: "day" }, 500_000, 2030),
    ).toBeCloseTo(9125, 6);
    // simple 3% for 4 years: 10,000 × (1 + 0.03 × 4) = 11,200
    expect(ltcRiderMonthly({ ...rider, inflationRider: "simple" }, 500_000, 2030)).toBeCloseTo(11_200, 6);
  });

  it("a rider's cap is the lower of the max share and face less the guaranteed minimum (fixed, never inflated)", () => {
    expect(ltcRiderCap(rider, 500_000)).toBe(500_000);
    expect(ltcRiderCap({ ...rider, riderMaxPct: 0.5 }, 500_000)).toBe(250_000); // 50% × 500,000
    expect(ltcRiderCap({ ...rider, residualDeathBenefit: 100_000 }, 500_000)).toBe(400_000); // 500,000 − 100,000
    expect(ltcRiderCap({ ...rider, residualDeathBenefit: 600_000 }, 500_000)).toBe(0); // floored at 0
  });

  it("names a policy's premium and benefit rows by its id", () => {
    expect(ltcPremiumExpenseId("p1")).toBe("ltc-premium-p1");
    expect(ltcBenefitIncomeId("p1")).toBe("ltc-benefit-p1");
  });
});
