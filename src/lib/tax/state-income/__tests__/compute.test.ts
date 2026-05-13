// src/lib/tax/state-income/__tests__/compute.test.ts
import { describe, it, expect } from "vitest";
import { computeStateIncomeTax } from "../compute";
import type { ComputeStateIncomeTaxInput } from "../compute";

const BASE_FEDERAL_INCOME: ComputeStateIncomeTaxInput["federalIncome"] = {
  agi: 100_000,
  taxableIncome: 88_000,
  ordinaryIncome: 100_000,
  dividends: 0,
  capitalGains: 0,
  earnedIncome: 100_000,
  taxableSocialSecurity: 0,
  taxExemptIncome: 0,
};

const BASE_RETIREMENT: ComputeStateIncomeTaxInput["retirementBreakdown"] = {
  db: 0, ira: 0, k401: 0, annuity: 0,
};

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

describe("computeStateIncomeTax — income base", () => {
  it("CO 2026 uses Federal Taxable Income, not AGI", () => {
    const r = computeStateIncomeTax({
      state: "CO", year: 2026, filingStatus: "single", primaryAge: 45,
      federalIncome: {
        agi: 100_000, taxableIncome: 85_000, ordinaryIncome: 0,
        earnedIncome: 100_000, dividends: 0, capitalGains: 0,
        taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.incomeBase).toBe("federal-taxable");
    expect(r.startingIncome).toBe(85_000); // not 100_000
  });

  it("CT 2026 adds back tax-exempt interest", () => {
    const r = computeStateIncomeTax({
      state: "CT", year: 2026, filingStatus: "single", primaryAge: 45,
      federalIncome: {
        agi: 100_000, taxableIncome: 85_000, ordinaryIncome: 0,
        earnedIncome: 95_000, dividends: 0, capitalGains: 0,
        taxableSocialSecurity: 0, taxExemptIncome: 5_000,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.addbacks.taxFreeInterest).toBe(5_000);
    expect(r.stateAGI).toBe(105_000); // 100_000 AGI + 5_000 addback
  });
});

describe("computeStateIncomeTax — easy FAGI-base states", () => {
  it("AZ 2026 single, $100K FAGI, no SS/retirement → flat 2.5% on (AGI − std ded)", () => {
    const r = computeStateIncomeTax({
      state: "AZ",
      year: 2026,
      filingStatus: "single",
      primaryAge: 45,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    // AZ uses Federal AGI as base. Std deduction single 2026 = 8350. No exemption.
    // Taxable = 100_000 - 8350 = 91_650. Rate 2.5% → 2291.25.
    expect(r.stateTax).toBeCloseTo(2291.25, 2);
    expect(r.incomeBase).toBe("federal-agi");
    expect(r.stateAGI).toBe(100_000);
    expect(r.stdDeduction).toBe(8350);
    expect(r.stateTaxableIncome).toBe(91_650);
    expect(r.hasIncomeTax).toBe(true);
  });
});
