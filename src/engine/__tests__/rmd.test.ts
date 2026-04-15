import { describe, it, expect } from "vitest";
import { calculateRMD, getRmdStartAge, isRmdEligibleSubType } from "../rmd";

describe("getRmdStartAge", () => {
  it("returns 73 for birth year 1951-1959", () => {
    expect(getRmdStartAge(1951)).toBe(73);
    expect(getRmdStartAge(1955)).toBe(73);
    expect(getRmdStartAge(1959)).toBe(73);
  });

  it("returns 75 for birth year 1960 or later", () => {
    expect(getRmdStartAge(1960)).toBe(75);
    expect(getRmdStartAge(1970)).toBe(75);
    expect(getRmdStartAge(1990)).toBe(75);
  });
});

describe("calculateRMD", () => {
  it("returns 0 when age is below RMD start age", () => {
    // Born 1970, age 72 => below 75 threshold
    expect(calculateRMD(500000, 72, 1970)).toBe(0);
    // Born 1955, age 72 => below 73 threshold
    expect(calculateRMD(500000, 72, 1955)).toBe(0);
  });

  it("returns 0 when balance is zero or negative", () => {
    expect(calculateRMD(0, 75, 1960)).toBe(0);
    expect(calculateRMD(-10000, 75, 1960)).toBe(0);
  });

  it("calculates correct RMD at age 73 for pre-1960 birth year", () => {
    // Born 1955, age 73, divisor = 26.5
    const rmd = calculateRMD(500000, 73, 1955);
    expect(rmd).toBeCloseTo(500000 / 26.5, 2);
  });

  it("calculates correct RMD at age 75 for post-1960 birth year", () => {
    // Born 1970, age 75, divisor = 24.6
    const rmd = calculateRMD(500000, 75, 1970);
    expect(rmd).toBeCloseTo(500000 / 24.6, 2);
  });

  it("calculates correct RMD at age 80", () => {
    // divisor = 20.2
    const rmd = calculateRMD(1000000, 80, 1950);
    expect(rmd).toBeCloseTo(1000000 / 20.2, 2);
  });

  it("calculates correct RMD at age 90", () => {
    // divisor = 12.2
    const rmd = calculateRMD(400000, 90, 1950);
    expect(rmd).toBeCloseTo(400000 / 12.2, 2);
  });

  it("handles ages beyond 120 by capping at 120", () => {
    // divisor at 120 = 2.0
    const rmd = calculateRMD(100000, 125, 1900);
    expect(rmd).toBeCloseTo(100000 / 2.0, 2);
  });

  it("increases RMD percentage as age increases", () => {
    const balance = 500000;
    const rmd75 = calculateRMD(balance, 75, 1950);
    const rmd85 = calculateRMD(balance, 85, 1950);
    const rmd95 = calculateRMD(balance, 95, 1950);
    // Older age means higher divisor, so larger percentage withdrawn
    expect(rmd85).toBeGreaterThan(rmd75);
    expect(rmd95).toBeGreaterThan(rmd85);
  });
});

describe("isRmdEligibleSubType", () => {
  it("returns true for traditional_ira and 401k", () => {
    expect(isRmdEligibleSubType("traditional_ira")).toBe(true);
    expect(isRmdEligibleSubType("401k")).toBe(true);
  });

  it("returns false for roth types and other types", () => {
    expect(isRmdEligibleSubType("roth_ira")).toBe(false);
    expect(isRmdEligibleSubType("roth_401k")).toBe(false);
    expect(isRmdEligibleSubType("529")).toBe(false);
    expect(isRmdEligibleSubType("brokerage")).toBe(false);
    expect(isRmdEligibleSubType("savings")).toBe(false);
  });
});
