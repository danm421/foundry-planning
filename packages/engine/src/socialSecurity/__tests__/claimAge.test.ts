import { describe, it, expect } from "vitest";
import { resolveClaimAgeMonths } from "../claimAge";
import type { Income, ClientInfo } from "../../types";

function baseClient(overrides: Partial<ClientInfo> = {}): ClientInfo {
  return {
    firstName: "C",
    lastName: "L",
    dateOfBirth: "1960-06-01",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "single",
    ...overrides,
  };
}

function baseRow(overrides: Partial<Income> = {}): Income {
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
    ...overrides,
  };
}

describe("resolveClaimAgeMonths — 'years' mode", () => {
  it("returns claimingAge * 12 + claimingAgeMonths when both set", () => {
    const row = baseRow({ claimingAgeMode: "years", claimingAge: 66, claimingAgeMonths: 4 });
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(66 * 12 + 4);
  });
  it("treats unset claimingAgeMode as 'years' (legacy rows)", () => {
    const row = baseRow({ claimingAge: 67, claimingAgeMonths: 0 });
    // no claimingAgeMode set
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(67 * 12);
  });
  it("treats missing claimingAgeMonths as 0", () => {
    const row = baseRow({ claimingAgeMode: "years", claimingAge: 65 });
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(65 * 12);
  });
  it("returns null when claimingAge is unset in 'years' mode", () => {
    const row = baseRow({ claimingAgeMode: "years", claimingAge: undefined });
    expect(resolveClaimAgeMonths(row, baseClient())).toBeNull();
  });
});

describe("resolveClaimAgeMonths — 'fra' mode", () => {
  it("returns FRA totalMonths for client's DOB", () => {
    // Born 1960-06-01 → FRA 67y 0m = 804 months
    const row = baseRow({ claimingAgeMode: "fra", owner: "client" });
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(804);
  });
  it("returns FRA totalMonths for spouse's DOB when owner is 'spouse'", () => {
    // Born 1956-08-01 → FRA 66y 4m = 796 months
    const row = baseRow({ claimingAgeMode: "fra", owner: "spouse" });
    const client = baseClient({ spouseDob: "1956-08-01" });
    expect(resolveClaimAgeMonths(row, client)).toBe(796);
  });
  it("returns null when DOB is missing (client)", () => {
    const row = baseRow({ claimingAgeMode: "fra", owner: "client" });
    const client = baseClient({ dateOfBirth: "" as string });
    expect(resolveClaimAgeMonths(row, client)).toBeNull();
  });
  it("returns null when spouse DOB is missing", () => {
    const row = baseRow({ claimingAgeMode: "fra", owner: "spouse" });
    const client = baseClient(); // no spouseDob
    expect(resolveClaimAgeMonths(row, client)).toBeNull();
  });
});

describe("resolveClaimAgeMonths — 'at_retirement' mode", () => {
  it("returns client retirementAge * 12", () => {
    const row = baseRow({ claimingAgeMode: "at_retirement", owner: "client" });
    expect(resolveClaimAgeMonths(row, baseClient({ retirementAge: 65 }))).toBe(65 * 12);
  });
  it("returns spouseRetirementAge * 12 when owner is 'spouse'", () => {
    const row = baseRow({ claimingAgeMode: "at_retirement", owner: "spouse" });
    const client = baseClient({ spouseDob: "1962-01-01", spouseRetirementAge: 63 });
    expect(resolveClaimAgeMonths(row, client)).toBe(63 * 12);
  });
  it("returns null when spouseRetirementAge is unset", () => {
    const row = baseRow({ claimingAgeMode: "at_retirement", owner: "spouse" });
    const client = baseClient({ spouseDob: "1962-01-01" }); // no spouseRetirementAge
    expect(resolveClaimAgeMonths(row, client)).toBeNull();
  });
});
