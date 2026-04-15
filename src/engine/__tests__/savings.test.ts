import { describe, it, expect } from "vitest";
import { applySavingsRules } from "../savings";
import { sampleSavingsRules } from "./fixtures";

describe("applySavingsRules", () => {
  it("applies employee contribution to the target account", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 50000, 150000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
  });

  it("calculates employer match (50% up to 6% of salary)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 50000, 150000);
    expect(result.employerTotal).toBe(4500);
  });

  it("caps contribution at available surplus", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 5000, 150000);
    expect(result.byAccount["acct-401k"]).toBe(5000);
    expect(result.total).toBe(5000);
  });

  it("caps contribution at annual limit", () => {
    const rules = [{ ...sampleSavingsRules[0], annualAmount: 50000, annualLimit: 23500 }];
    const result = applySavingsRules(rules, 2026, 100000, 150000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
  });

  it("skips rules outside their year range", () => {
    const result = applySavingsRules(sampleSavingsRules, 2036, 50000, 150000);
    expect(result.total).toBe(0);
    expect(result.employerTotal).toBe(0);
  });

  it("returns zeros when no surplus", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 0, 150000);
    expect(result.total).toBe(0);
  });
});
