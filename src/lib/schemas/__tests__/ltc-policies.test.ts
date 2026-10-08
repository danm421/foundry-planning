// src/lib/schemas/__tests__/ltc-policies.test.ts
import { describe, it, expect } from "vitest";
import {
  ltcPolicyCreateSchema,
  ltcPolicyUpdateSchema,
  ltcPolicyProblems,
  LTC_STANDALONE_DEFAULTS,
  LTC_RIDER_DEFAULTS,
} from "../ltc-policies";

const LIFE = "20000000-0000-4000-8000-000000000001";
const standalone = { name: "Genworth", insured: "client", issueYear: 2018, ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400 };
const rider = { name: "LTC rider", insured: "client", issueYear: 2018, ...LTC_RIDER_DEFAULTS, lifePolicyAccountId: LIFE };

const messages = (body: unknown) => {
  const r = ltcPolicyCreateSchema.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("ltcPolicyCreateSchema", () => {
  it("accepts the standalone and rider starting values", () => {
    expect(messages(standalone)).toEqual([]);
    expect(messages(rider)).toEqual([]);
  });

  it("needs a life policy, a benefit mode and a payout cap on a rider", () => {
    expect(messages({ ...rider, lifePolicyAccountId: null })).toContain("Pick the life policy this rider is on.");
    expect(messages({ ...rider, riderBenefitMode: null })).toContain("Choose how the rider's benefit is set.");
    expect(messages({ ...rider, riderMonthlyPct: null })).toContain("Enter the share of the death benefit paid each month.");
    expect(messages({ ...rider, riderMaxPct: null })).toContain("Enter how much of the death benefit the rider can pay out.");
  });

  it("refuses a premium or shared care on a rider", () => {
    expect(messages({ ...rider, annualPremium: 500 })).toContain(
      "A rider has no premium of its own. Its cost is inside the life policy's premium.",
    );
    expect(messages({ ...rider, sharedCare: true })).toContain("Shared care applies to traditional policies only.");
  });

  it("needs a benefit and a benefit period on a standalone policy, and no life policy", () => {
    expect(messages({ ...standalone, benefitAmount: 0 })).toContain("Enter the policy's benefit amount.");
    expect(messages({ ...standalone, benefitPeriodMode: null })).toContain("Choose how long benefits last.");
    expect(messages({ ...standalone, benefitPeriodYears: null })).toContain("Enter the number of years benefits last.");
    expect(messages({ ...standalone, lifePolicyAccountId: LIFE })).toContain("Only a rider is linked to a life policy.");
  });

  it("needs the companion value for a to-age or fixed-years premium", () => {
    expect(messages({ ...standalone, premiumPayMode: "to_age" })).toContain("Enter the age premiums stop.");
    expect(messages({ ...standalone, premiumPayMode: "years" })).toContain("Enter how many years premiums are paid.");
  });
});

describe("ltcPolicyUpdateSchema", () => {
  // strictPartial: an absent key stays absent — no default may fire, or a
  // one-key PATCH would reset the rest of the row.
  it("parses a one-key body to exactly that key", () => {
    expect(ltcPolicyUpdateSchema.parse({ annualPremium: 3000 })).toEqual({ annualPremium: 3000 });
  });
});

describe("ltcPolicyProblems", () => {
  it("reads a missing kind as standalone", () => {
    expect(ltcPolicyProblems({ benefitAmount: 0 }).map((p) => p.path)).toContain("benefitAmount");
  });
});
