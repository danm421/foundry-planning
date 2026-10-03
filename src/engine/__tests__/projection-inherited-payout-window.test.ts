import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, FamilyMember } from "../types";

// The Karen case (spec 2026-10-03): heir (the client) born 1954; inherited
// Traditional IRA, owner born 1930 died 2026 (had started RMDs) → 10-year rule
// with yearly RMDs, empty by Dec 31, 2036. Heir divisor 16.4 in 2027, then 1
// less each year. 0% growth keeps the arithmetic exact: after the 2027–2030
// minimums the balance is OPENING × 12.4 / 16.4 (the factors telescope).
const HEIR_BIRTH_YEAR = 1954;
const OPENING = 228_195;
const ID = "acct-inh";
const AT_2031 = (OPENING * 12.4) / 16.4;

const soloClient: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
    firstName: "Karen", lastName: "Test", dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`,
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
    id: ID, name: "Inherited IRA", category: "retirement", subType: "traditional_ira",
    titlingType: "jtwros", value: OPENING, basis: 0, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    inheritedDeathYear: 2026, inheritedOwnerBirthYear: 1930,
    ...overrides,
  };
}

const WINDOW = { inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2036 };

function project(acct: Account) {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, acct],
    incomes: [], expenses: [], liabilities: [], savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2038 },
  });
  const years = runProjection(data);
  return (y: number) => {
    const row = years.find((r) => r.year === y);
    if (!row) throw new Error(`no projection row for ${y}`);
    return row;
  };
}

const rmdLines = (row: ReturnType<ReturnType<typeof project>>) =>
  row.accountLedgers[ID].entries.filter((e) => e.category === "rmd");

describe("projection — inherited IRA payout window (the Karen case)", () => {
  const withWindow = project(inheritedIra(WINDOW));
  const noWindow = project(inheritedIra());

  it("takes nothing in the year of death", () => {
    expect(withWindow(2026).accountLedgers[ID].rmdAmount).toBe(0);
  });

  it("2027–2030 pay exactly the minimum, identical to the no-window plan", () => {
    for (let y = 2027; y <= 2030; y++) {
      const amount = withWindow(y).accountLedgers[ID].rmdAmount;
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBe(noWindow(y).accountLedgers[ID].rmdAmount);
      expect(rmdLines(withWindow(y))).toHaveLength(1);
    }
    expect(withWindow(2027).accountLedgers[ID].rmdAmount).toBeCloseTo(OPENING / 16.4, 6);
  });

  it("2031–2036 pay level amounts and the account is empty after 2036", () => {
    for (let y = 2031; y <= 2036; y++) {
      expect(withWindow(y).accountLedgers[ID].rmdAmount).toBeCloseTo(AT_2031 / 6, 2);
    }
    expect(withWindow(2036).accountLedgers[ID].endingValue).toBeCloseTo(0, 6);
    expect(withWindow(2037).accountLedgers[ID].rmdAmount).toBe(0);
    expect(withWindow(2038).accountLedgers[ID].endingValue).toBeCloseTo(0, 6);
  });

  it("removes the year-10 lump the no-window plan takes", () => {
    // No window: minimums 2027–2035 (divisors 16.4 … 8.4) leave OPENING × 7.4 / 16.4.
    expect(noWindow(2036).accountLedgers[ID].rmdAmount).toBeCloseTo((OPENING * 7.4) / 16.4, 2);
    expect(withWindow(2036).accountLedgers[ID].rmdAmount).toBeCloseTo(AT_2031 / 6, 2);
  });

  it("lists the minimum and the planned extra as two ledger lines that sum to the payout", () => {
    const y2031 = withWindow(2031);
    const lines = rmdLines(y2031);
    expect(lines.map((e) => e.label)).toEqual([
      "Inherited IRA RMD (10-year rule, divisor 12.4)",
      "Inherited IRA planned payout (spread evenly 2031–2036)",
    ]);
    expect(lines[0].amount).toBeCloseTo(-AT_2031 / 12.4, 2);
    expect(lines[1].amount).toBeCloseTo(-(AT_2031 / 6 - AT_2031 / 12.4), 2);
    expect(lines[0].amount + lines[1].amount).toBeCloseTo(-y2031.accountLedgers[ID].rmdAmount, 6);
  });

  it("taxes the whole payout as ordinary income", () => {
    const y2031 = withWindow(2031);
    const src = y2031.taxDetail!.bySource[`${ID}:rmd`];
    expect(src.type).toBe("ordinary_income");
    expect(src.amount).toBeCloseTo(AT_2031 / 6, 2);
  });

  it("splits after-tax basis across the two lines by amount, summing to the year's basis change", () => {
    const y2031 = project(inheritedIra({ ...WINDOW, basis: 50_000 }))(2031);
    const led = y2031.accountLedgers[ID];
    const [minLine, extraLine] = rmdLines(y2031);
    expect(minLine.basis).toBeLessThan(0);
    expect(extraLine.basis).toBeLessThan(0);
    expect(minLine.basis! / minLine.amount).toBeCloseTo(extraLine.basis! / extraLine.amount, 9);
    expect(minLine.basis! + extraLine.basis!).toBeCloseTo(led.basisEoY! - led.basisBoY!, 6);
  });

  it("clamps a window past the deadline (a Forge or scenario value) to 2036", () => {
    const clamped = project(inheritedIra({ inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2040 }));
    expect(clamped(2031).accountLedgers[ID].rmdAmount).toBeCloseTo(AT_2031 / 6, 2);
    expect(clamped(2036).accountLedgers[ID].endingValue).toBeCloseTo(0, 6);
  });
});

describe("projection — inherited Roth with a payout window", () => {
  it("pays the even share tax-free, with only the planned line while no minimum is due", () => {
    const at = project(inheritedIra({
      subType: "roth_ira", value: 100_000,
      inheritedPayoutFromYear: 2034, inheritedPayoutThroughYear: 2036,
    }));
    const y2034 = at(2034);
    expect(y2034.accountLedgers[ID].rmdAmount).toBeCloseTo(100_000 / 3, 2);
    expect(rmdLines(y2034).map((e) => e.label)).toEqual(["Inherited IRA planned payout (spread evenly 2034–2036)"]);
    const inhRows = Object.entries(y2034.taxDetail!.bySource).filter(([k]) => k.includes(ID));
    expect(inhRows.map(([k, v]) => [k, v.type])).toEqual([[`inherited_roth_tax_free:${ID}`, "tax_free"]]);
    expect(y2034.taxDetail!.ordinaryIncome).toBe(0);
    expect(at(2036).accountLedgers[ID].endingValue).toBeCloseTo(0, 6);
  });
});
