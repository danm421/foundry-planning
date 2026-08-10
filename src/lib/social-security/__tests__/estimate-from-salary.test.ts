import { describe, expect, it } from "vitest";
import { estimatePiaFromSalary, ownerAnnualSalary } from "../estimate-from-salary";

const YEAR = 2026;

describe("ownerAnnualSalary", () => {
  it("sums the owner's salary rows", () => {
    const rows = [
      { type: "salary", owner: "client", annualAmount: "100000", endYear: 2040 },
      { type: "salary", owner: "client", annualAmount: "20000", endYear: 2040 },
    ];
    expect(ownerAnnualSalary(rows, "client", YEAR)).toBe(120_000);
  });

  it("ignores the other person's salary", () => {
    const rows = [
      { type: "salary", owner: "client", annualAmount: "100000", endYear: 2040 },
      { type: "salary", owner: "spouse", annualAmount: "80000", endYear: 2040 },
    ];
    expect(ownerAnnualSalary(rows, "client", YEAR)).toBe(100_000);
    expect(ownerAnnualSalary(rows, "spouse", YEAR)).toBe(80_000);
  });

  it("ignores income that is not a salary", () => {
    // Pension, SS and business income are not covered W-2 wages, so none of
    // them may inflate the AIME this estimate is built on.
    const rows = [
      { type: "deferred", owner: "client", annualAmount: "50000", endYear: 2040 },
      { type: "social_security", owner: "client", annualAmount: "30000", endYear: 2099 },
      { type: "business", owner: "client", annualAmount: "70000", endYear: 2040 },
    ];
    expect(ownerAnnualSalary(rows, "client", YEAR)).toBe(0);
  });

  it("ignores a salary that has already ended", () => {
    const rows = [
      { type: "salary", owner: "client", annualAmount: "100000", endYear: 2020 },
      { type: "salary", owner: "client", annualAmount: "90000", endYear: 2040 },
    ];
    expect(ownerAnnualSalary(rows, "client", YEAR)).toBe(90_000);
  });

  it("keeps a salary that ends this year and one that has not started", () => {
    const rows = [
      { type: "salary", owner: "client", annualAmount: "40000", endYear: YEAR },
      { type: "salary", owner: "client", annualAmount: "10000", endYear: 2050 },
    ];
    expect(ownerAnnualSalary(rows, "client", YEAR)).toBe(50_000);
  });

  it("tolerates a null or unparseable amount", () => {
    const rows = [
      { type: "salary", owner: "client", annualAmount: null, endYear: 2040 },
      { type: "salary", owner: "client", annualAmount: "", endYear: 2040 },
      { type: "salary", owner: "client", annualAmount: "75000", endYear: 2040 },
    ];
    expect(ownerAnnualSalary(rows, "client", YEAR)).toBe(75_000);
  });

  it("returns 0 when the owner has no salary at all", () => {
    expect(ownerAnnualSalary([], "client", YEAR)).toBe(0);
  });

  it("excludes a joint-owned row — Social Security is credited per person", () => {
    const rows = [{ type: "salary", owner: "joint", annualAmount: "100000", endYear: 2040 }];
    expect(ownerAnnualSalary(rows, "client", YEAR)).toBe(0);
  });
});

describe("estimatePiaFromSalary", () => {
  it("credits a full 35-year career at the stated salary", () => {
    // AIME = 100000/12 = 8333.33, which lands above the second bend point:
    //   0.9*1226 + 0.32*(7391-1226) + 0.15*(8333.33-7391) = 3217.55
    expect(estimatePiaFromSalary(100_000)).toBe(3218);
  });

  it("matches SSA's bands at a lower salary", () => {
    // AIME = 5000: 0.9*1226 + 0.32*(5000-1226) = 2311.08
    expect(estimatePiaFromSalary(60_000)).toBe(2311);
  });

  it("caps covered earnings at the wage base", () => {
    expect(estimatePiaFromSalary(1_000_000)).toBe(estimatePiaFromSalary(184_500));
  });

  it("returns 0 for a non-earner", () => {
    expect(estimatePiaFromSalary(0)).toBe(0);
    expect(estimatePiaFromSalary(-1)).toBe(0);
  });

  it("rounds to whole dollars for the dialog's amount box", () => {
    expect(Number.isInteger(estimatePiaFromSalary(83_456))).toBe(true);
  });
});
