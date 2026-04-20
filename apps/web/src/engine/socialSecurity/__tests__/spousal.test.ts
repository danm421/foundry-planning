import { describe, it, expect } from "vitest";
import { computeSpousalMonthlyBenefit, topUp } from "../spousal";

describe("computeSpousalMonthlyBenefit", () => {
  it("returns 0 when other spouse has not yet claimed", () => {
    expect(computeSpousalMonthlyBenefit({
      otherPiaMonthly: 2000,
      otherSpouseHasClaimed: false,
      claimAgeMonths: 804,
      dob: "1960-06-01",
    })).toBe(0);
  });

  it("returns 50% of other PIA when claimed at FRA", () => {
    // Born 1960 → FRA 67y = 804m. Claim at 804 → no reduction.
    expect(computeSpousalMonthlyBenefit({
      otherPiaMonthly: 2000,
      otherSpouseHasClaimed: true,
      claimAgeMonths: 804,
      dob: "1960-06-01",
    })).toBeCloseTo(1000, 2);
  });

  it("no DRC on spousal when claimed after FRA", () => {
    // Claim 70y = 840m, 36 months past FRA 67y, but spousal gets no DRC
    expect(computeSpousalMonthlyBenefit({
      otherPiaMonthly: 2000,
      otherSpouseHasClaimed: true,
      claimAgeMonths: 840,
      dob: "1960-06-01",
    })).toBeCloseTo(1000, 2);
  });

  it("claim-62 spousal with FRA-67 → base × 0.65", () => {
    // base = 1000, 60 months early: first 36 × 25/36% = 0.25, extended 24 × 5/12% = 0.10
    // total reduction 0.35 → 1000 × 0.65 = 650
    expect(computeSpousalMonthlyBenefit({
      otherPiaMonthly: 2000,
      otherSpouseHasClaimed: true,
      claimAgeMonths: 744,
      dob: "1960-06-01",
    })).toBeCloseTo(650, 2);
  });

  it("returns 0 when otherPiaMonthly is 0", () => {
    expect(computeSpousalMonthlyBenefit({
      otherPiaMonthly: 0,
      otherSpouseHasClaimed: true,
      claimAgeMonths: 804,
      dob: "1960-06-01",
    })).toBe(0);
  });
});

describe("topUp decomposition (§5.4.2)", () => {
  it("own ≥ spousal → total is own, spousal portion 0", () => {
    expect(topUp(1200, 1000)).toEqual({ total: 1200, retirement: 1200, spousalPortion: 0 });
  });
  it("own < spousal → total is spousal, retirement + top-up portions", () => {
    // eMoney §5.4.2 example: Bob PIA 2000, Jan PIA 300, Jan@FRA → total 1000 = 300 ret + 700 spousal
    expect(topUp(300, 1000)).toEqual({ total: 1000, retirement: 300, spousalPortion: 700 });
  });
  it("own = spousal → ambiguous but pick own (retirement-first rule)", () => {
    expect(topUp(500, 500)).toEqual({ total: 500, retirement: 500, spousalPortion: 0 });
  });
  it("combined reduced case — each reduced independently then recombined", () => {
    // §5.4.2 "Combined Reduced Benefits": spousal $900, own $400 → $900 = $400 ret + $500 spousal
    expect(topUp(400, 900)).toEqual({ total: 900, retirement: 400, spousalPortion: 500 });
  });
});
