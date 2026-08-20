import { describe, it, expect } from "vitest";
import { rowToDisabilityPolicy } from "../load-disability-policies";
import type { DisabilityPolicyRow } from "@/db/schema";

const row = {
  id: "dp-1",
  clientId: "c-1",
  name: "Group disability",
  insured: "client",
  carrier: null,
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  hasShortTerm: true,
  stdEliminationDays: 7,
  stdBenefitPct: "0.6000",
  stdDurationWeeks: 13,
  stdMonthlyMax: null,
  hasLongTerm: true,
  ltdEliminationDays: 90,
  ltdBenefitPct: "0.6000",
  ltdMonthlyMax: "10000.00",
  ltdBenefitPeriodMode: "to_age",
  ltdBenefitPeriodAge: 65,
  ltdBenefitPeriodYears: null,
  benefitTaxable: true,
  colaRate: "0.0000",
  annualPremium: "0",
  premiumPayer: "employer",
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as DisabilityPolicyRow;

describe("rowToDisabilityPolicy", () => {
  it("parses decimal-as-string columns into numbers", () => {
    const p = rowToDisabilityPolicy(row);
    expect(p.shortTerm!.benefitPct).toBe(0.6);
    expect(p.longTerm!.monthlyMax).toBe(10_000);
    expect(p.colaRate).toBe(0);
  });

  it("collapses has_short_term=false into a null block", () => {
    const p = rowToDisabilityPolicy({ ...row, hasShortTerm: false });
    expect(p.shortTerm).toBeNull();
    expect(p.longTerm).not.toBeNull();
  });

  it("collapses has_long_term=false into a null block", () => {
    const p = rowToDisabilityPolicy({ ...row, hasLongTerm: false });
    expect(p.longTerm).toBeNull();
  });

  it("maps a null monthly max to null, not zero", () => {
    // A zero cap would silently pay nothing. This is the trap in this mapper.
    const p = rowToDisabilityPolicy({ ...row, ltdMonthlyMax: null });
    expect(p.longTerm!.monthlyMax).toBeNull();
    // The base fixture already carries these two as null — assert them too,
    // so a naive Number(v) on either column (not just ltdMonthlyMax) fails here.
    expect(p.coveredEarningsAmount).toBeNull();
    expect(p.shortTerm!.monthlyMax).toBeNull();
  });

  it("builds the years benefit period from ltdBenefitPeriodYears", () => {
    const p = rowToDisabilityPolicy({
      ...row,
      ltdBenefitPeriodMode: "years",
      ltdBenefitPeriodYears: 5,
    });
    expect(p.longTerm!.benefitPeriod).toEqual({ mode: "years", years: 5 });
  });
});
