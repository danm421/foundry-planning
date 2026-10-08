import { describe, it, expect } from "vitest";
import { ltcInflationFactor, ltcMonthlyFromUnit } from "../ltc-benefits";

describe("ltcInflationFactor", () => {
  const p = (inflationRider: "none" | "simple" | "compound") => ({ inflationRider, inflationRate: 0.03, issueYear: 2016 });
  it("grows from the ISSUE year, simple or compound, and not at all with none", () => {
    expect(ltcInflationFactor(p("none"), 2026)).toBe(1);
    expect(ltcInflationFactor(p("simple"), 2026)).toBeCloseTo(1.3, 10);
    expect(ltcInflationFactor(p("compound"), 2026)).toBeCloseTo(1.343916379, 8);
  });
  it("is 1 in or before the issue year", () => {
    expect(ltcInflationFactor(p("compound"), 2016)).toBe(1);
    expect(ltcInflationFactor(p("compound"), 2010)).toBe(1);
  });
});

describe("ltcMonthlyFromUnit", () => {
  it("turns a daily benefit into a monthly one as day × 365 / 12", () => {
    expect(ltcMonthlyFromUnit(200, "day")).toBeCloseTo(6083.333, 3);
    expect(ltcMonthlyFromUnit(6000, "month")).toBe(6000);
  });
});
