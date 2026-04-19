import { describe, it, expect } from "vitest";
import { applySavingsRules } from "../savings";
import { sampleSavingsRules } from "./fixtures";

describe("applySavingsRules", () => {
  it("applies employee contribution to the target account", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, 50000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
  });

  it("calculates employer match (50% up to 6% of salary)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, 50000);
    expect(result.employerTotal).toBe(4500);
  });

  it("caps contribution at available surplus (legacy path)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, 5000);
    expect(result.byAccount["acct-401k"]).toBe(5000);
    expect(result.total).toBe(5000);
  });

  it("skips rules outside their year range", () => {
    const result = applySavingsRules(sampleSavingsRules, 2036, 150000, 50000);
    expect(result.total).toBe(0);
    expect(result.employerTotal).toBe(0);
  });

  it("returns zeros when surplus cap is 0 (legacy path)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000, 0);
    expect(result.total).toBe(0);
  });

  it("applies full rule amount when no surplus cap is provided (checking-account path)", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 150000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
    expect(result.total).toBe(23500);
  });
});
