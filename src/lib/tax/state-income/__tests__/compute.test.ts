// src/lib/tax/state-income/__tests__/compute.test.ts
import { describe, it, expect } from "vitest";
import { computeStateIncomeTax } from "../compute";

describe("computeStateIncomeTax — no-income-tax states", () => {
  it.each(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WY"] as const)(
    "returns zero tax for %s",
    (state) => {
      const r = computeStateIncomeTax({
        state,
        year: 2026,
        filingStatus: "married_joint",
        primaryAge: 65,
        federalIncome: {
          agi: 200_000,
          taxableIncome: 175_000,
          ordinaryIncome: 100_000,
          dividends: 10_000,
          capitalGains: 30_000,
          earnedIncome: 0,
          taxableSocialSecurity: 20_000,
          taxExemptIncome: 0,
        },
        retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
        preTaxContrib: 0,
        fallbackFlatRate: 0.05,
      });
      expect(r.stateTax).toBe(0);
      expect(r.hasIncomeTax).toBe(false);
      expect(r.state).toBe(state);
    },
  );

  it("returns flat-rate fallback when state is null", () => {
    const r = computeStateIncomeTax({
      state: null,
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 65,
      federalIncome: {
        agi: 200_000, taxableIncome: 175_000, ordinaryIncome: 100_000,
        dividends: 0, capitalGains: 0, earnedIncome: 0,
        taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0,
      fallbackFlatRate: 0.05,
    });
    expect(r.stateTax).toBe(175_000 * 0.05);
    expect(r.state).toBeNull();
  });
});
