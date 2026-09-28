import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, FamilyMember } from "../types";

// Spec example 2: owner born 1945 died 2022 (had started RMDs); heir (the
// client) born 1975 → 10-year rule with yearly RMDs, empty by Dec 31, 2032.
const HEIR_BIRTH_YEAR = 1975;

const soloClient: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
    firstName: "Heir", lastName: "Test", dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`,
  },
];

const checking: Account = {
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 5000, basis: 5000, growthRate: 0, rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

function inheritedIra(overrides?: Partial<Account>): Account {
  return {
    id: "acct-inh", name: "Inherited IRA", category: "retirement", subType: "traditional_ira",
    titlingType: "jtwros", value: 400_000, basis: 0, growthRate: 0,
    // Deliberately off: an inherited IRA follows the beneficiary schedule regardless.
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945,
    ...overrides,
  };
}

function project(acct: Account, planStartYear = 2026, planEndYear = 2034) {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, acct],
    incomes: [], expenses: [], liabilities: [], savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear, planEndYear },
  });
  const years = runProjection(data);
  return (y: number) => {
    const row = years.find((r) => r.year === y);
    if (!row) throw new Error(`no projection row for ${y}`);
    return row;
  };
}

describe("projection — inherited IRA (10-year rule, owner had started RMDs)", () => {
  it("takes the life-expectancy RMD in 2026 even though the heir is 51 and rmdEnabled is false", () => {
    const year = project(inheritedIra())(2026);
    const ledger = year.accountLedgers["acct-inh"];
    expect(ledger.rmdAmount).toBeCloseTo(400_000 / 35.1, 6);
    expect(ledger.entries.some((e) => e.label === "Inherited IRA RMD (10-year rule, divisor 35.1)")).toBe(true);
    const src = year.taxDetail!.bySource["acct-inh:rmd"];
    expect(src.type).toBe("ordinary_income");
    expect(src.amount).toBeCloseTo(400_000 / 35.1, 6);
  });

  it("empties the account in 2032 and leaves it at $0 afterwards", () => {
    const at = project(inheritedIra());
    const final = at(2032).accountLedgers["acct-inh"];
    // At 0% growth each yearly RMD 2026–2031 removes 1/divisor, so 2032 opens
    // at 400,000 × 29.1 / 35.1. Pins that the yearly RMDs actually ran.
    expect(final.rmdAmount).toBeCloseTo((400_000 * 29.1) / 35.1, 2);
    expect(final.endingValue).toBe(0);
    expect(final.entries.some((e) => e.label === "Inherited IRA RMD (10-year rule, final payout)")).toBe(true);
    expect(at(2033).accountLedgers["acct-inh"].rmdAmount).toBe(0);
    expect(at(2033).accountLedgers["acct-inh"].endingValue).toBe(0);
    expect(at(2034).accountLedgers["acct-inh"].endingValue).toBe(0);
  });

  it("uses priorYearEndValue for the first plan year", () => {
    const year = project(inheritedIra({ priorYearEndValue: 380_000 }))(2026);
    expect(year.accountLedgers["acct-inh"].rmdAmount).toBeCloseTo(380_000 / 35.1, 6);
  });

  it("takes nothing in the year of death when that is the plan's first year", () => {
    const at = project(inheritedIra({ inheritedDeathYear: 2026 }));
    expect(at(2026).accountLedgers["acct-inh"].rmdAmount).toBe(0);
    expect(at(2027).accountLedgers["acct-inh"].rmdAmount).toBeGreaterThan(0);
  });
});

describe("projection — inherited Roth IRA", () => {
  it("has no yearly RMDs and pays the full balance out tax-free in 2032", () => {
    const at = project(inheritedIra({ id: "acct-inh", subType: "roth_ira" }));
    expect(at(2026).accountLedgers["acct-inh"].rmdAmount).toBe(0);
    const y2032 = at(2032);
    expect(y2032.accountLedgers["acct-inh"].rmdAmount).toBeCloseTo(400_000, 6);
    expect(y2032.accountLedgers["acct-inh"].endingValue).toBe(0);
    expect(y2032.taxDetail!.bySource["acct-inh:rmd"]).toBeUndefined();
    expect(y2032.taxDetail!.ordinaryIncome).toBe(0);
  });

  it("counts the tax-free payout in Total Income, and Net Cash Flow matches the cash that reached checking", () => {
    const y2032 = project(inheritedIra({ subType: "roth_ira" }))(2032);
    expect(y2032.totalIncome).toBeCloseTo(400_000, 6);
    expect(y2032.taxDetail!.ordinaryIncome).toBe(0);
    const chk = y2032.accountLedgers["acct-checking"];
    expect(chk.endingValue - chk.beginningValue).toBeCloseTo(400_000, 6);
    expect(y2032.netCashFlow).toBeCloseTo(chk.endingValue - chk.beginningValue, 6);
  });

  it("counts the payout as household cash when sizing surplus-capped savings (no checking account)", () => {
    // Without a default checking account the legacy path caps savings at the
    // year's household surplus, so the payout must count as an inflow there.
    const brokerage: Account = {
      id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
      titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [brokerage, inheritedIra({ subType: "roth_ira" })],
      incomes: [], expenses: [], liabilities: [],
      savingsRules: [{
        id: "save-brokerage", accountId: "acct-brokerage", annualAmount: 10_000,
        isDeductible: false, startYear: 2026, endYear: 2034,
      }],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2034 },
    });
    const years = runProjection(data);
    expect(years.find((r) => r.year === 2031)!.savings.total).toBe(0);
    expect(years.find((r) => r.year === 2032)!.savings.total).toBeCloseTo(10_000, 6);
  });
});

describe("projection — a non-inherited IRA is unchanged", () => {
  it("still takes no RMD before the owner's own RMD age", () => {
    const year = project(inheritedIra({ inheritedDeathYear: null, inheritedOwnerBirthYear: null, rmdEnabled: true }))(2026);
    expect(year.accountLedgers["acct-inh"].rmdAmount).toBe(0);
  });
});
