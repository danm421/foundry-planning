// src/lib/tax/state-income/__tests__/compute-529.test.ts
import { describe, it, expect } from "vitest";
import { computeStateIncomeTax } from "../compute";
import type { ComputeStateIncomeTaxInput } from "../compute";
import type { USPSStateCode } from "@/lib/usps-states";
import type { FilingStatus } from "@/lib/tax/types";

function buildInput(opts: {
  state: USPSStateCode;
  filingStatus?: FilingStatus;
  contrib529?: { total: number; byBeneficiary: number[] };
}): ComputeStateIncomeTaxInput {
  return {
    state: opts.state,
    year: 2026,
    filingStatus: opts.filingStatus ?? "single",
    primaryAge: 45,
    federalIncome: {
      agi: 100_000,
      taxableIncome: 88_000,
      ordinaryIncome: 100_000,
      dividends: 0,
      capitalGains: 0,
      shortCapitalGains: 0,
      earnedIncome: 100_000,
      taxableSocialSecurity: 0,
      taxExemptIncome: 0,
    },
    retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
    preTaxContrib: 0,
    fallbackFlatRate: 0,
    contrib529: opts.contrib529,
  };
}

describe("state 529 contribution benefit", () => {
  it("NY MFJ: deducts up to $10k of 529 contributions from state AGI", () => {
    const withC = computeStateIncomeTax(
      buildInput({ state: "NY", filingStatus: "married_joint", contrib529: { total: 15_000, byBeneficiary: [15_000] } }),
    );
    const without = computeStateIncomeTax(buildInput({ state: "NY", filingStatus: "married_joint" }));
    expect(without.stateTaxableIncome - withC.stateTaxableIncome).toBe(10_000); // capped
    expect(withC.diag.notes.some((n) => n.includes("529"))).toBe(true);
  });

  it("CA: no effect", () => {
    const withC = computeStateIncomeTax(
      buildInput({ state: "CA", contrib529: { total: 15_000, byBeneficiary: [15_000] } }),
    );
    const without = computeStateIncomeTax(buildInput({ state: "CA" }));
    expect(withC.stateTax).toBe(without.stateTax);
  });

  it("IN: 20% credit up to $1,500 reduces tax directly", () => {
    const withC = computeStateIncomeTax(
      buildInput({ state: "IN", contrib529: { total: 10_000, byBeneficiary: [10_000] } }),
    );
    const without = computeStateIncomeTax(buildInput({ state: "IN" }));
    expect(without.stateTax - withC.stateTax).toBeCloseTo(1_500, 0); // min(10k×20%, 1500)
  });

  it("OH per-beneficiary: two beneficiaries double the cap", () => {
    const one = computeStateIncomeTax(
      buildInput({ state: "OH", contrib529: { total: 10_000, byBeneficiary: [10_000] } }),
    );
    const two = computeStateIncomeTax(
      buildInput({ state: "OH", contrib529: { total: 10_000, byBeneficiary: [5_000, 5_000] } }),
    );
    expect(two.stateTaxableIncome).toBeLessThan(one.stateTaxableIncome); // 8k vs 4k deducted
  });
});
