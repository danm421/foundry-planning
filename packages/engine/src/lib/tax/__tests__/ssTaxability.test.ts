import { describe, it, expect } from "vitest";
import { calcTaxableSocialSecurity } from "../ssTaxability";

describe("calcTaxableSocialSecurity (MFJ)", () => {
  it("returns 0 when no SS benefits", () => {
    expect(calcTaxableSocialSecurity({ ssGross: 0, otherIncome: 50000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBe(0);
  });

  it("returns 0 when combined income below first base ($32k MFJ)", () => {
    // Combined = 10000 + 10000 + 0 = 20000 < 32000
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 10000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBe(0);
  });

  it("returns up to 50% of SS when combined income is between $32k and $44k MFJ", () => {
    // Combined 25000+10000=35000, first-tier excess 3000, 50% = 1500
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 25000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBeCloseTo(1500, 2);
  });

  it("returns up to 85% of SS when combined income above $44k MFJ", () => {
    // Combined 60000+15000=75000
    // tier1=min(50%*ss, 50%*12000)=min(15000, 6000)=6000
    // tier2=85%*(75000-44000)=26350
    // subtotal=32350, cap=85%*30000=25500 → 25500
    expect(calcTaxableSocialSecurity({ ssGross: 30000, otherIncome: 60000, taxExemptInterest: 0, filingStatus: "married_joint" })).toBeCloseTo(25500, 2);
  });

  it("includes tax-exempt interest in combined income", () => {
    // Combined 25000+10000+5000=40000
    // tier1=50%*min(8000, 12000)=4000, below 44000 so no tier2
    // 50% of SS=10000 → taxable=min(4000, 10000)=4000
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 25000, taxExemptInterest: 5000, filingStatus: "married_joint" })).toBeCloseTo(4000, 2);
  });
});

describe("calcTaxableSocialSecurity (single)", () => {
  it("uses $25k/$34k thresholds for single", () => {
    // Combined 18000+10000=28000, excess 3000, 50%=1500
    expect(calcTaxableSocialSecurity({ ssGross: 20000, otherIncome: 18000, taxExemptInterest: 0, filingStatus: "single" })).toBeCloseTo(1500, 2);
  });
});
