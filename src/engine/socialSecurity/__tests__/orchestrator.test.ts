import { describe, it, expect } from "vitest";
import { resolveAnnualBenefit } from "../orchestrator";
import type { Income, ClientInfo } from "../../types";

const baseClient: ClientInfo = {
  firstName: "C",
  lastName: "L",
  dateOfBirth: "1960-06-01",       // FRA 67y 0m
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "married_joint",
  spouseDob: "1962-06-01",          // FRA 67y 0m
  spouseLifeExpectancy: 85,
  lifeExpectancy: 90,
};

function ssIncome(overrides: Partial<Income>): Income {
  return {
    id: "c",
    type: "social_security",
    name: "SS",
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
    ...overrides,
  };
}

describe("resolveAnnualBenefit — both alive, both claimed", () => {
  it("own > spousal: total = own, spousal = 0", () => {
    const client = ssIncome({ id: "c", owner: "client", piaMonthly: 2000 });
    const spouse = ssIncome({ id: "s", owner: "spouse", piaMonthly: 1500 });
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: baseClient, year: 2027 });
    // Client claims at FRA 67 in 2027. Own=2000, spousal=50%×1500=750. own>spousal → 2000/mo
    expect(out.retirement).toBeCloseTo(2000 * 12, 2);
    expect(out.spousal).toBeCloseTo(0, 2);
    expect(out.survivor).toBeCloseTo(0, 2);
    expect(out.total).toBeCloseTo(2000 * 12, 2);
  });

  it("own < spousal: top-up applied", () => {
    const client = ssIncome({ id: "c", owner: "client", piaMonthly: 300 });
    const spouse = ssIncome({ id: "s", owner: "spouse", piaMonthly: 2000 });
    // Spouse must have claimed — spouse turns 67 in 2029; client turns 67 in 2027.
    // Year 2029: both have claimed.
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: baseClient, year: 2029 });
    // client own=300, spousal base = 1000. Both at FRA: total=1000, ret=300, spousalPortion=700
    expect(out.retirement).toBeCloseTo(300 * 12, 2);
    expect(out.spousal).toBeCloseTo(700 * 12, 2);
    expect(out.survivor).toBeCloseTo(0, 2);
    expect(out.total).toBeCloseTo(1000 * 12, 2);
  });
});

describe("resolveAnnualBenefit — this spouse not yet claimed", () => {
  it("returns zeros", () => {
    const client = ssIncome({ id: "c", owner: "client", claimingAge: 67 });
    const spouse = ssIncome({ id: "s", owner: "spouse" });
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: baseClient, year: 2020 });
    expect(out.total).toBe(0);
  });
});

describe("resolveAnnualBenefit — other spouse not claimed, this spouse has", () => {
  it("pays own only, no spousal", () => {
    const client = ssIncome({ id: "c", owner: "client", claimingAge: 67, piaMonthly: 2000 });
    const spouse = ssIncome({ id: "s", owner: "spouse", claimingAge: 70, piaMonthly: 1500 });
    // Year 2027: client 67 (claimed), spouse 65 (not claimed until 2032)
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: baseClient, year: 2027 });
    expect(out.retirement).toBeCloseTo(2000 * 12, 2);
    expect(out.spousal).toBe(0);
  });
});

describe("resolveAnnualBenefit — single client (no spouse row)", () => {
  it("pays own only", () => {
    const client = ssIncome({ id: "c", owner: "client", piaMonthly: 2000 });
    const out = resolveAnnualBenefit({ row: client, spouseRow: null, client: { ...baseClient, spouseDob: undefined }, year: 2027 });
    expect(out.retirement).toBeCloseTo(2000 * 12, 2);
    expect(out.total).toBeCloseTo(2000 * 12, 2);
  });
});

describe("resolveAnnualBenefit — survivor scenarios", () => {
  it("pays zero when survivor is below age 60", () => {
    // Spouse dies at lifeExpectancy 85 → year 2047 (spouse born 1962)
    // Client born 1960 → in 2047 client is 87. But test with earlier death for age-60 boundary.
    const client = ssIncome({ id: "c", owner: "client", claimingAge: 67, piaMonthly: 2000 });
    const spouse = ssIncome({ id: "s", owner: "spouse", claimingAge: 67, piaMonthly: 1500 });
    const earlyDeathClient: ClientInfo = { ...baseClient, spouseLifeExpectancy: 40 };
    // Spouse dies 2002 (born 1962 + 40). Client born 1960 — in 2002 is 42, below 60.
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: earlyDeathClient, year: 2005 });
    expect(out.total).toBe(0);
  });

  it("survivor past age 60 but before own claim: pays survivor only", () => {
    const client = ssIncome({ id: "c", owner: "client", claimingAge: 67, piaMonthly: 2000 });
    const spouse = ssIncome({ id: "s", owner: "spouse", claimingAge: 67, piaMonthly: 3000 });
    // Spouse dies at lifeExpectancy 63 → death year 2025 (= last alive year).
    // Survivor benefits begin year AFTER death → 2026. Client born 1960, in
    // 2026 age 66 (past 60, before own claim 67).
    const earlyDeath: ClientInfo = { ...baseClient, spouseLifeExpectancy: 63 };
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: earlyDeath, year: 2026 });
    expect(out.retirement).toBe(0);
    expect(out.spousal).toBe(0);
    // Survivor gets 3000/mo max, reduced for early claim (age 66 vs survivor-FRA 67)
    // survivor FRA 67y (born 1960), 12 months early, reduction 12 × 0.285/84 ≈ 0.0407
    // → 3000 × (1 - 0.0407) ≈ 2877.86/mo → 34534.29/yr
    expect(out.survivor).toBeGreaterThan(33000);
    expect(out.survivor).toBeLessThan(36000);
    expect(out.total).toBeCloseTo(out.survivor, 2);
  });

  it("survivor past own claim age: max(own, survivor) with retirement-first decomposition", () => {
    // Own 2000/mo, survivor 3000/mo → total 3000 = 2000 ret + 1000 survivor
    const client = ssIncome({ id: "c", owner: "client", claimingAge: 67, piaMonthly: 2000 });
    const spouse = ssIncome({ id: "s", owner: "spouse", claimingAge: 67, piaMonthly: 3000 });
    const earlyDeath: ClientInfo = { ...baseClient, spouseLifeExpectancy: 63 };
    // Year 2030: client age 70, past own claim 67 AND past survivor-FRA 67
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: earlyDeath, year: 2030 });
    expect(out.retirement).toBeCloseTo(2000 * 12, 2);
    expect(out.survivor).toBeCloseTo(1000 * 12, 2);
    expect(out.total).toBeCloseTo(3000 * 12, 2);
  });
});

describe("resolveAnnualBenefit — growth indexing", () => {
  it("applies growthRate from inflationStartYear to the total", () => {
    const client = ssIncome({ id: "c", owner: "client", piaMonthly: 2000, growthRate: 0.03 });
    const spouse = ssIncome({ id: "s", owner: "spouse", piaMonthly: 1000, growthRate: 0.03 });
    const out = resolveAnnualBenefit({ row: client, spouseRow: spouse, client: baseClient, year: 2027 });
    // Client claims at 67 in 2027 (7 years after inflationStartYear 2020). Own 2000 > spousal 500.
    // Annual = 2000 × 12 × 1.03^7
    const expected = 2000 * 12 * Math.pow(1.03, 7);
    expect(out.total).toBeCloseTo(expected, 2);
  });
});

describe("resolveAnnualBenefit — claimingAgeMode integration", () => {
  it("honors claimingAgeMode='fra' for this-spouse own benefit", () => {
    const client = ssIncome({
      id: "c",
      owner: "client",
      piaMonthly: 2000,
      claimingAge: 62,          // ignored when mode='fra'
      claimingAgeMode: "fra",
    });
    // baseClient DOB 1960-06-01 → FRA 67y = 804 months → first claim year 2027
    // In 2027, benefit should be FULL PIA (no early reduction), annualized
    const out = resolveAnnualBenefit({ row: client, spouseRow: null, client: { ...baseClient, spouseDob: undefined }, year: 2027 });
    expect(out.total).toBeCloseTo(2000 * 12, 2);
  });

  it("honors claimingAgeMode='at_retirement' for this-spouse own benefit", () => {
    const client = ssIncome({
      id: "c",
      owner: "client",
      piaMonthly: 2000,
      claimingAgeMode: "at_retirement",
    });
    // baseClient.retirementAge = 65 → 780 months → early reduction vs FRA 804 = 24 months
    // Reduction = 24 × 5/9% = 0.1333 → benefit = 2000 × 0.8667 = 1733.33/mo → 20800/yr
    const out = resolveAnnualBenefit({ row: client, spouseRow: null, client: { ...baseClient, spouseDob: undefined }, year: 2025 });
    expect(out.total).toBeCloseTo(2000 * (1 - 24 * (5 / 900)) * 12, 2);
  });
});
