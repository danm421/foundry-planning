import { describe, it, expect } from "vitest";
import type { DisabilityPolicy } from "@/engine/types";
import { rowToDisabilityPolicy } from "../load-disability-policies";
import { disabilityPolicyToRow, disabilitySetToColumns } from "../disability-policy-row";

const POLICY: DisabilityPolicy = {
  id: "d1",
  name: "Group disability",
  insured: "client",
  coveredEarningsMode: "manual",
  coveredEarningsAmount: 180_000,
  shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: 10_000,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: true,
  colaRate: 0.02,
  annualPremium: 1_200,
  premiumPayer: "employer",
};

describe("disabilityPolicyToRow", () => {
  it("round-trips through rowToDisabilityPolicy", () => {
    const row = { id: "d1", clientId: "c1", ...disabilityPolicyToRow(POLICY) };
    expect(rowToDisabilityPolicy(row as never)).toEqual(POLICY);
  });

  it("round-trips a policy with no short-term layer and a lifetime benefit period", () => {
    const policy: DisabilityPolicy = {
      ...POLICY,
      shortTerm: null,
      longTerm: { ...POLICY.longTerm!, benefitPeriod: { mode: "lifetime" } },
    };
    const row = { id: "d1", clientId: "c1", ...disabilityPolicyToRow(policy) };
    expect(rowToDisabilityPolicy(row as never)).toEqual(policy);
  });

  it("carries the display-only carrier and notes the engine type lacks", () => {
    const withDisplay = { ...POLICY, carrier: "Acme Mutual", notes: "Via employer" };
    expect(disabilityPolicyToRow(withDisplay)).toMatchObject({
      carrier: "Acme Mutual",
      notes: "Via employer",
    });
  });
});

describe("disabilitySetToColumns", () => {
  it("maps a cleared short-term layer to hasShortTerm:false only", () => {
    expect(disabilitySetToColumns({ shortTerm: null })).toEqual({ hasShortTerm: false });
  });

  it("maps a benefit period union to its columns", () => {
    expect(
      disabilitySetToColumns({
        longTerm: { ...POLICY.longTerm!, benefitPeriod: { mode: "years", years: 5 } },
      }),
    ).toMatchObject({
      hasLongTerm: true,
      ltdBenefitPeriodMode: "years",
      ltdBenefitPeriodYears: 5,
      ltdBenefitPeriodAge: null,
    });
  });

  it("passes flat fields through untouched and emits no layer columns it was not given", () => {
    expect(disabilitySetToColumns({ colaRate: 0.03, annualPremium: 900 })).toEqual({
      colaRate: 0.03,
      annualPremium: 900,
    });
  });
});
