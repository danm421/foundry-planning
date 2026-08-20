import { describe, it, expect } from "vitest";
import { synthesizeDisabilityPremiums } from "../disability-premium-expense";
import { buildClientData, basePlanSettings } from "@/engine/__tests__/fixtures";
import type { DisabilityPolicy } from "@/engine/types";

const base: DisabilityPolicy = {
  id: "dp-1",
  name: "Individual LTD",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  shortTerm: null,
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: null,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: false,
  colaRate: 0,
  annualPremium: 2400,
  premiumPayer: "insured",
};

describe("synthesizeDisabilityPremiums", () => {
  it("bills an insured-paid premium from plan start to the insured's retirement year", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({ disabilityPolicies: [base] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].annualAmount).toBe(2400);
    expect(out[0].type).toBe("insurance");
    expect(out[0].startYear).toBe(basePlanSettings.planStartYear);
    // baseClient: DOB 1970, retirementAge 65 => retires 2035.
    expect(out[0].endYear).toBe(2035);
  });

  it("bills nothing when the employer pays", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({ disabilityPolicies: [{ ...base, premiumPayer: "employer" }] }),
    );
    expect(out).toEqual([]);
  });

  it("bills nothing when the premium is zero", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({ disabilityPolicies: [{ ...base, annualPremium: 0 }] }),
    );
    expect(out).toEqual([]);
  });

  it("stops the premium the year before disability starts — waiver of premium", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({
        disabilityPolicies: [base],
        planSettings: {
          ...basePlanSettings,
          disabilityEvent: { person: "client", startYear: 2030 },
        },
      }),
    );
    expect(out[0].endYear).toBe(2029);
  });

  it("does not apply waiver when the OTHER person is the one disabled", () => {
    const out = synthesizeDisabilityPremiums(
      buildClientData({
        disabilityPolicies: [base],
        planSettings: {
          ...basePlanSettings,
          disabilityEvent: { person: "spouse", startYear: 2030 },
        },
      }),
    );
    expect(out[0].endYear).toBe(2035);
  });

  it("bills a spouse-insured policy through the SPOUSE's retirement year, not the client's", () => {
    // baseClient: spouseDob 1972-06-15, spouseRetirementAge 65 => spouse retires 2037.
    // Client retires 2035 (see first test). If the resolver ever used the
    // client's retirement year for a spouse-insured policy, this would wrongly
    // assert 2035 and the bug would slip through.
    const out = synthesizeDisabilityPremiums(
      buildClientData({
        disabilityPolicies: [{ ...base, insured: "spouse" }],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].endYear).toBe(2037);
  });

  it("boundary: bills through the last year before disability and stops exactly there", () => {
    // Pins BOTH the last billed year and the first unbilled year explicitly —
    // a test that only checks a total could pass with the boundary off by one.
    const out = synthesizeDisabilityPremiums(
      buildClientData({
        disabilityPolicies: [base],
        planSettings: {
          ...basePlanSettings,
          disabilityEvent: { person: "client", startYear: 2030 },
        },
      }),
    );
    const lastBilledYear = out[0].endYear;
    const firstUnbilledYear = lastBilledYear + 1;
    expect(lastBilledYear).toBe(2029);
    expect(firstUnbilledYear).toBe(2030); // the disability's own start year
  });
});
