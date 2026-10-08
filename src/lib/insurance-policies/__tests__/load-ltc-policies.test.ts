import { describe, it, expect } from "vitest";
import { rowToLtcPolicy } from "../load-ltc-policies";
import type { LtcPolicyRow } from "@/db/schema";

const row = {
  id: "ltc-1",
  clientId: "c-1",
  name: "Genworth LTC",
  insured: "spouse",
  carrier: "Genworth",
  kind: "standalone",
  lifePolicyAccountId: null,
  issueYear: 2018,
  benefitAmount: "6000.00",
  benefitUnit: "month",
  riderBenefitMode: null,
  riderMonthlyPct: null,
  benefitPeriodMode: "years",
  benefitPeriodYears: 3,
  riderMaxPct: null,
  extensionYears: 0,
  residualDeathBenefit: "0.00",
  eliminationDays: 90,
  homeCarePct: "0.5000",
  inflationRider: "compound",
  inflationRate: "0.0300",
  benefitType: "reimbursement",
  sharedCare: true,
  annualPremium: "2400.00",
  premiumPayMode: "to_age",
  premiumPayToAge: 65,
  premiumPayYears: null,
  partnership: false,
  notes: "Shared care with Tom",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as LtcPolicyRow;

describe("rowToLtcPolicy", () => {
  it("turns decimal columns into numbers and keeps every other field as stored", () => {
    expect(rowToLtcPolicy(row)).toEqual({
      id: "ltc-1",
      name: "Genworth LTC",
      insured: "spouse",
      carrier: "Genworth",
      kind: "standalone",
      lifePolicyAccountId: null,
      issueYear: 2018,
      benefitAmount: 6000,
      benefitUnit: "month",
      riderBenefitMode: null,
      riderMonthlyPct: null,
      benefitPeriodMode: "years",
      benefitPeriodYears: 3,
      riderMaxPct: null,
      extensionYears: 0,
      residualDeathBenefit: 0,
      eliminationDays: 90,
      homeCarePct: 0.5,
      inflationRider: "compound",
      inflationRate: 0.03,
      benefitType: "reimbursement",
      sharedCare: true,
      annualPremium: 2400,
      premiumPayMode: "to_age",
      premiumPayToAge: 65,
      premiumPayYears: null,
      partnership: false,
      notes: "Shared care with Tom",
    });
  });

  it("keeps a rider's nullable percentages null rather than 0", () => {
    const rider = rowToLtcPolicy({
      ...row,
      kind: "life_rider",
      riderBenefitMode: "pct_of_face",
      riderMonthlyPct: "0.02000",
      riderMaxPct: null,
    } as unknown as LtcPolicyRow);
    expect(rider.riderMonthlyPct).toBe(0.02);
    expect(rider.riderMaxPct).toBeNull();
  });
});
