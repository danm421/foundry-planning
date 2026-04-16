import { describe, it, expect } from "vitest";
import {
  deriveAboveLineFromSavings,
  sumItemizedFromEntries,
  SALT_CAP,
  type SavingsRuleForDeduction,
  type AccountForDeduction,
  type ClientDeductionRow,
} from "../derive-deductions";

const isGrantorAlways = () => true;
const isGrantorNever = () => false;

const ACCT_TRADITIONAL_IRA: AccountForDeduction = {
  id: "acct-ira",
  subType: "traditional_ira",
  ownerEntityId: null,
};
const ACCT_401K: AccountForDeduction = {
  id: "acct-401k",
  subType: "401k",
  ownerEntityId: null,
};
const ACCT_ROTH_IRA: AccountForDeduction = {
  id: "acct-roth",
  subType: "roth_ira",
  ownerEntityId: null,
};
const ACCT_BROKERAGE: AccountForDeduction = {
  id: "acct-brk",
  subType: "brokerage",
  ownerEntityId: null,
};

function makeRule(accountId: string, amount: number, startYear = 2026, endYear = 2076): SavingsRuleForDeduction {
  return { accountId, annualAmount: amount, startYear, endYear };
}

describe("deriveAboveLineFromSavings", () => {
  it("sums traditional IRA contributions", () => {
    const rules = [makeRule("acct-ira", 7500)];
    expect(deriveAboveLineFromSavings(2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways)).toBe(7500);
  });

  it("sums 401k contributions", () => {
    const rules = [makeRule("acct-401k", 24500)];
    expect(deriveAboveLineFromSavings(2026, rules, [ACCT_401K], isGrantorAlways)).toBe(24500);
  });

  it("sums multiple deductible rules", () => {
    const rules = [makeRule("acct-401k", 24500), makeRule("acct-ira", 7500)];
    expect(deriveAboveLineFromSavings(2026, rules, [ACCT_401K, ACCT_TRADITIONAL_IRA], isGrantorAlways)).toBe(32000);
  });

  it("excludes Roth IRA contributions", () => {
    const rules = [makeRule("acct-roth", 7500)];
    expect(deriveAboveLineFromSavings(2026, rules, [ACCT_ROTH_IRA], isGrantorAlways)).toBe(0);
  });

  it("excludes brokerage / non-retirement contributions", () => {
    const rules = [makeRule("acct-brk", 50000)];
    expect(deriveAboveLineFromSavings(2026, rules, [ACCT_BROKERAGE], isGrantorAlways)).toBe(0);
  });

  it("excludes pre-startYear contributions", () => {
    const rules = [makeRule("acct-ira", 7500, 2030, 2076)];
    expect(deriveAboveLineFromSavings(2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways)).toBe(0);
  });

  it("excludes post-endYear contributions", () => {
    const rules = [makeRule("acct-ira", 7500, 2026, 2030)];
    expect(deriveAboveLineFromSavings(2031, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways)).toBe(0);
  });

  it("excludes contributions to non-grantor entity accounts", () => {
    const acctEntity: AccountForDeduction = {
      id: "acct-trust",
      subType: "traditional_ira",
      ownerEntityId: "entity-1",
    };
    const rules = [makeRule("acct-trust", 7500)];
    expect(deriveAboveLineFromSavings(2026, rules, [acctEntity], isGrantorNever)).toBe(0);
  });

  it("includes contributions to grantor entity accounts", () => {
    const acctEntity: AccountForDeduction = {
      id: "acct-grantor",
      subType: "traditional_ira",
      ownerEntityId: "entity-1",
    };
    const rules = [makeRule("acct-grantor", 7500)];
    expect(deriveAboveLineFromSavings(2026, rules, [acctEntity], isGrantorAlways)).toBe(7500);
  });

  it("returns 0 for empty rules", () => {
    expect(deriveAboveLineFromSavings(2026, [], [], isGrantorAlways)).toBe(0);
  });

  it("skips rule whose account is not in the accounts list (defensive)", () => {
    const rules = [makeRule("acct-missing", 7500)];
    expect(deriveAboveLineFromSavings(2026, rules, [], isGrantorAlways)).toBe(0);
  });
});

function makeRow(type: ClientDeductionRow["type"], amount: number, growth = 0, startYear = 2026, endYear = 2076): ClientDeductionRow {
  return { type, annualAmount: amount, growthRate: growth, startYear, endYear };
}

describe("sumItemizedFromEntries", () => {
  it("returns 0 for empty rows", () => {
    expect(sumItemizedFromEntries(2026, [])).toBe(0);
  });

  it("sums a single charitable_cash row at face value (no growth)", () => {
    expect(sumItemizedFromEntries(2026, [makeRow("charitable_cash", 25000)])).toBe(25000);
  });

  it("inflates a charitable_cash row by growth rate", () => {
    // 25000 × 1.02^4 = 27060.804...
    const result = sumItemizedFromEntries(2030, [makeRow("charitable_cash", 25000, 0.02)]);
    expect(result).toBeCloseTo(27060.8, 1);
  });

  it("leaves SALT under cap unchanged", () => {
    expect(sumItemizedFromEntries(2026, [makeRow("salt", 5000)])).toBe(5000);
  });

  it("caps SALT at $10k", () => {
    expect(sumItemizedFromEntries(2026, [makeRow("salt", 20000)])).toBe(SALT_CAP);
  });

  it("pools multiple SALT rows before applying cap", () => {
    const rows = [makeRow("salt", 7000), makeRow("salt", 5000)];
    expect(sumItemizedFromEntries(2026, rows)).toBe(SALT_CAP);
  });

  it("caps SALT but sums other types at full value", () => {
    const rows = [
      makeRow("salt", 20000),
      makeRow("charitable_cash", 30000),
      makeRow("mortgage_interest", 18000),
    ];
    expect(sumItemizedFromEntries(2026, rows)).toBe(SALT_CAP + 30000 + 18000);
  });

  it("excludes pre-startYear rows", () => {
    expect(sumItemizedFromEntries(2026, [makeRow("charitable_cash", 25000, 0, 2030, 2076)])).toBe(0);
  });

  it("excludes post-endYear rows", () => {
    expect(sumItemizedFromEntries(2031, [makeRow("charitable_cash", 25000, 0, 2026, 2030)])).toBe(0);
  });

  it("'other_itemized' rows are summed without cap", () => {
    const rows = [makeRow("other_itemized", 50000), makeRow("other_itemized", 25000)];
    expect(sumItemizedFromEntries(2026, rows)).toBe(75000);
  });

  it("computes growth independently per row", () => {
    // Row A starts 2026 grows 5%; row B starts 2028 grows 3%
    // Year 2030: A = 10000 × 1.05^4 = 12155.0625
    //            B = 5000 × 1.03^2 = 5304.5
    const rows = [makeRow("charitable_cash", 10000, 0.05, 2026), makeRow("charitable_cash", 5000, 0.03, 2028)];
    const result = sumItemizedFromEntries(2030, rows);
    expect(result).toBeCloseTo(12155.0625 + 5304.5, 2);
  });
});
