import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, FamilyMember } from "../types";

// SECURE 2.0 §325 (effective 2024, so every projection year): designated Roth
// balances inside a 401(k)/403(b) are exempt from lifetime RMDs. The RMD basis
// must be the pre-tax slice only — prior-year-end balance minus the BoY Roth
// value — never the Roth-inclusive account total.

const BIRTH_YEAR = 1951; // age 75 in 2026 → uniform-lifetime divisor 24.6
const DIVISOR_AT_75 = 24.6;

const soloClient: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Solo",
    lastName: "Test",
    dateOfBirth: `${BIRTH_YEAR}-01-01`,
  },
];

const checking: Account = {
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros",
  value: 5000, basis: 5000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

function build401k(overrides?: Partial<Account>): Account {
  return {
    id: "acct-401k", name: "Mixed 401(k)", category: "retirement", subType: "401k",
    titlingType: "jtwros",
    value: 1_000_000, basis: 0, growthRate: 0, rmdEnabled: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...overrides,
  };
}

function runYearOne(acct: Account) {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: `${BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, acct],
    incomes: [], expenses: [], liabilities: [], savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027 },
  });
  return runProjection(data)[0];
}

describe("RMDs on mixed Roth/pre-tax 401(k)s (SECURE 2.0 §325)", () => {
  it("computes the RMD on the pre-tax slice only, and books it all as ordinary income", () => {
    const year = runYearOne(build401k({ rothValue: 400_000 }));
    const expectedRmd = 600_000 / DIVISOR_AT_75; // pre-tax = $1M − $400k Roth

    expect(year.accountLedgers["acct-401k"].rmdAmount).toBeCloseTo(expectedRmd, 6);
    const bySource = year.taxDetail!.bySource["acct-401k:rmd"];
    expect(bySource.type).toBe("ordinary_income");
    expect(bySource.amount).toBeCloseTo(expectedRmd, 6);
    // Full RMD stays ordinary income (all-pre-tax draw, Roth slice untouched).
    expect(year.taxDetail!.ordinaryIncome).toBeCloseTo(expectedRmd, 6);
  });

  it("leaves pure pre-tax 401(k) RMDs unchanged", () => {
    const year = runYearOne(build401k());
    const expectedRmd = 1_000_000 / DIVISOR_AT_75;

    expect(year.accountLedgers["acct-401k"].rmdAmount).toBeCloseTo(expectedRmd, 6);
    expect(year.taxDetail!.ordinaryIncome).toBeCloseTo(expectedRmd, 6);
  });

  it("produces no RMD when the account is entirely Roth", () => {
    const year = runYearOne(build401k({ rothValue: 1_000_000 }));

    expect(year.accountLedgers["acct-401k"].rmdAmount).toBe(0);
    expect(year.taxDetail!.bySource["acct-401k:rmd"]).toBeUndefined();
    expect(year.taxDetail!.ordinaryIncome).toBe(0);
  });

  // Year-1 override: `priorYearEndValue` is a prior-Dec-31 GROSS custodian
  // snapshot on a different scale than the current-snapshot `rothValueBoY`.
  // Subtracting the raw Roth dollars from the prior-year gross is a scale
  // mismatch — with $600k Roth against a $500k prior-year balance it zeroes the
  // basis and skips the RMD entirely. The Roth fraction (60% of the current $1M
  // balance) must be applied to the prior-year gross: $500k × 40% = $200k.
  it("scales the Roth exclusion to the prior-year-end gross basis on a mixed account", () => {
    const year = runYearOne(
      build401k({ value: 1_000_000, rothValue: 600_000, priorYearEndValue: 500_000 }),
    );
    const expectedRmd = 200_000 / DIVISOR_AT_75;

    expect(year.accountLedgers["acct-401k"].rmdAmount).toBeCloseTo(expectedRmd, 6);
    expect(year.taxDetail!.ordinaryIncome).toBeCloseTo(expectedRmd, 6);
  });

  // Regression guard for the override path with no Roth: a pure pre-tax
  // account's Year-1 RMD keys off `priorYearEndValue` unchanged (fraction 0).
  it("uses priorYearEndValue unchanged for a pure pre-tax account", () => {
    const year = runYearOne(build401k({ value: 1_000_000, priorYearEndValue: 500_000 }));
    const expectedRmd = 500_000 / DIVISOR_AT_75;

    expect(year.accountLedgers["acct-401k"].rmdAmount).toBeCloseTo(expectedRmd, 6);
    expect(year.taxDetail!.ordinaryIncome).toBeCloseTo(expectedRmd, 6);
  });
});
