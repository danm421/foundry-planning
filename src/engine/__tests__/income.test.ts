import { describe, it, expect } from "vitest";
import { computeIncome } from "../income";
import { sampleIncomes, baseClient } from "./fixtures";
import type { Income, ClientInfo } from "../types";

describe("computeIncome", () => {
  it("sums active salary income for the year", () => {
    const result = computeIncome(sampleIncomes, 2026, baseClient);
    // John: 150000, Jane: 100000
    expect(result.salaries).toBe(250000);
    expect(result.total).toBe(250000);
  });

  it("applies growth rate in subsequent years", () => {
    const result = computeIncome(sampleIncomes, 2027, baseClient);
    // John: 150000 * 1.03 = 154500, Jane: 100000 * 1.03 = 103000
    expect(result.salaries).toBeCloseTo(257500, 0);
  });

  it("excludes income outside its start/end year range", () => {
    const result = computeIncome(sampleIncomes, 2036, baseClient);
    // John salary ends 2035, Jane salary still active
    // Jane: 100000 * 1.03^10 = 134391.64
    expect(result.salaries).toBeCloseTo(134391.64, 0);
  });

  it("delays social security until claiming age", () => {
    // John born 1970, claiming age 67 → starts 2037
    const before = computeIncome(sampleIncomes, 2036, baseClient);
    expect(before.socialSecurity).toBe(0);

    const after = computeIncome(sampleIncomes, 2037, baseClient);
    // SS: 36000 * 1.02^11 (11 years of COLA from 2026)
    expect(after.socialSecurity).toBeCloseTo(36000 * Math.pow(1.02, 11), 0);
  });

  it("returns all zeros when no income is active", () => {
    const result = computeIncome([], 2026, baseClient);
    expect(result.total).toBe(0);
    expect(result.salaries).toBe(0);
    expect(result.socialSecurity).toBe(0);
  });
});

const client: ClientInfo = {
  firstName: "Test",
  lastName: "User",
  dateOfBirth: "1960-06-01",   // FRA 67y 0m
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "single",
};

describe("computeIncome — SS pia_at_fra mode", () => {
  it("computes benefit from PIA using FRA adjustments", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,            // unused in pia_at_fra
      startYear: 2022,            // for inflationStartYear semantics below
      endYear: 2099,
      growthRate: 0,              // no COLA for this test
      owner: "client",
      claimingAge: 67,            // FRA
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2022,
    };
    // At FRA: monthly PIA × 12 = 24000
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(24000, 2);
  });

  it("applies early reduction: claim-62 FRA-67 → 70% of annual PIA", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 62,
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2022,
    };
    // 2000 × 0.70 × 12 = 16800
    const result = computeIncome([ss], 2022, client);
    expect(result.socialSecurity).toBeCloseTo(16800, 2);
  });

  it("returns 0 before claiming age", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2020,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 67,
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2020,
    };
    const result = computeIncome([ss], 2025, client); // age 65, not yet 67
    expect(result.socialSecurity).toBe(0);
  });

  it("applies growthRate from inflationStartYear to PIA", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0.03,  // 3% COLA
      owner: "client",
      claimingAge: 67,
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2022,
    };
    // Year 2027 claim at FRA, 5 years of 3% growth: 24000 × 1.03^5 ≈ 27820.85
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(24000 * Math.pow(1.03, 5), 2);
  });
});

describe("computeIncome — SS manual_amount mode (regression)", () => {
  it("behaves identically to pre-ssBenefitMode rows when mode is 'manual_amount'", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 30000,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0.02,
      owner: "client",
      claimingAge: 67,
      ssBenefitMode: "manual_amount",
      inflationStartYear: 2022,
    };
    // 30000 × 1.02^5 ≈ 33122.42
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(30000 * Math.pow(1.02, 5), 2);
  });
  it("behaves identically when ssBenefitMode is undefined (existing data)", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 30000,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0.02,
      owner: "client",
      claimingAge: 67,
      // no ssBenefitMode
      inflationStartYear: 2022,
    };
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(30000 * Math.pow(1.02, 5), 2);
  });
});
