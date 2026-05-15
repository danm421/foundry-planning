import { describe, it, expect } from "vitest";
import { applySavingsRules, resolveContributionAmount } from "../savings";
import { sampleSavingsRules, baseClient } from "./fixtures";
import type { SavingsRule } from "../types";

describe("applySavingsRules", () => {
  it("applies employee contribution to the target account", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, baseClient, 50000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
  });

  it("calculates employer match (50% up to 6% of salary)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, baseClient, 50000);
    expect(result.employerTotal).toBe(4500);
  });

  it("caps contribution at available surplus (legacy path)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, baseClient, 5000);
    expect(result.byAccount["acct-401k"]).toBe(5000);
    expect(result.total).toBe(5000);
  });

  it("skips rules outside their year range", () => {
    const result = applySavingsRules(sampleSavingsRules, 2036, 150000, baseClient, 50000);
    expect(result.total).toBe(0);
    expect(result.employerTotal).toBe(0);
  });

  it("returns zeros when surplus cap is 0 (legacy path)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, baseClient, 0);
    expect(result.total).toBe(0);
  });

  it("applies full rule amount when no surplus cap is provided (checking-account path)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, baseClient);
    expect(result.byAccount["acct-401k"]).toBe(23500);
    expect(result.total).toBe(23500);
  });

  it("resolves percent-mode contribution using per-rule salary map", () => {
    const percentRule: SavingsRule = {
      id: "sav-percent",
      accountId: "acct-401k",
      annualAmount: 0,
      annualPercent: 0.1,
      isDeductible: true,
      startYear: 2026,
      endYear: 2035,
    };
    const salaryByRuleId = { "sav-percent": 150000 };
    const result = applySavingsRules([percentRule], 2026, 0, baseClient, undefined, salaryByRuleId);
    expect(result.byAccount["acct-401k"]).toBeCloseTo(15000, 0);
  });

  it("percent-mode contribution with zero salary resolves to zero", () => {
    const percentRule: SavingsRule = {
      id: "sav-percent-no-salary",
      accountId: "acct-401k",
      annualAmount: 0,
      annualPercent: 0.1,
      isDeductible: true,
      startYear: 2026,
      endYear: 2035,
    };
    const salaryByRuleId = { "sav-percent-no-salary": 0 };
    const result = applySavingsRules([percentRule], 2026, 0, baseClient, undefined, salaryByRuleId);
    expect(result.total).toBe(0);
  });

  it("splits the contribution into rothByAccount by rothPercent", () => {
    const splitRule: SavingsRule = {
      id: "sav-split",
      accountId: "acct-401k",
      annualAmount: 10000,
      isDeductible: true,
      rothPercent: 0.4,
      startYear: 2026,
      endYear: 2035,
    };
    const result = applySavingsRules([splitRule], 2026, 150000, baseClient);
    expect(result.byAccount["acct-401k"]).toBe(10000);
    expect(result.rothByAccount["acct-401k"]).toBe(4000);
  });

  it("rothByAccount is empty when no rule has rothPercent", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, baseClient);
    expect(result.rothByAccount).toEqual({});
  });

  it("rothByAccount tracks the capped contribution, not the requested amount", () => {
    const splitRule: SavingsRule = {
      id: "sav-split-capped",
      accountId: "acct-401k",
      annualAmount: 10000,
      isDeductible: true,
      rothPercent: 0.5,
      startYear: 2026,
      endYear: 2035,
    };
    // legacy surplus cap of 4000 clamps the 10000 contribution
    const result = applySavingsRules([splitRule], 2026, 150000, baseClient, 4000);
    expect(result.byAccount["acct-401k"]).toBe(4000);
    expect(result.rothByAccount["acct-401k"]).toBe(2000);
  });
});

describe("resolveContributionAmount", () => {
  const base: SavingsRule = {
    id: "sav-1",
    accountId: "acct-401k",
    annualAmount: 23500,
    isDeductible: true,
    startYear: 2026,
    endYear: 2035,
  };

  it("returns annualAmount when annualPercent is null", () => {
    expect(resolveContributionAmount(base, 150000)).toBe(23500);
  });

  it("returns salary × annualPercent when percent is set", () => {
    const rule: SavingsRule = { ...base, annualAmount: 0, annualPercent: 0.1 };
    expect(resolveContributionAmount(rule, 150000)).toBeCloseTo(15000, 0);
  });

  it("returns 0 when percent-mode and salary is 0", () => {
    const rule: SavingsRule = { ...base, annualAmount: 0, annualPercent: 0.1 };
    expect(resolveContributionAmount(rule, 0)).toBe(0);
  });

  it("returns annualAmount when annualPercent is 0 (treat as unset)", () => {
    const rule: SavingsRule = { ...base, annualPercent: 0 };
    expect(resolveContributionAmount(rule, 150000)).toBe(23500);
  });
});
