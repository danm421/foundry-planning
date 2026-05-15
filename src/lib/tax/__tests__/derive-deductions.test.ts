import { describe, it, expect } from "vitest";
import {
  deriveAboveLineFromSavings,
  sumItemizedFromEntries,
  deriveAboveLineFromExpenses,
  deriveItemizedFromExpenses,
  deriveMortgageInterestFromLiabilities,
  derivePropertyTaxFromAccounts,
  aggregateDeductions,
  saltCap,
  type SavingsRuleForDeduction,
  type AccountForDeduction,
  type ClientDeductionRow,
  type DeductionContribution,
  type ExpenseForDeduction,
  type LiabilityForDeduction,
  type AccountForPropertyTax,
} from "../derive-deductions";

const isGrantorAlways = () => true;
const isGrantorNever = () => false;

const ACCT_TRADITIONAL_IRA: AccountForDeduction = {
  id: "acct-ira",
  subType: "traditional_ira",
  category: "retirement",
  ownerEntityId: null,
};
const ACCT_401K: AccountForDeduction = {
  id: "acct-401k",
  subType: "401k",
  category: "retirement",
  ownerEntityId: null,
};
const ACCT_403B: AccountForDeduction = {
  id: "acct-403b",
  subType: "403b",
  category: "retirement",
  ownerEntityId: null,
};
const ACCT_OTHER_RETIREMENT: AccountForDeduction = {
  id: "acct-other-ret",
  subType: "other",
  category: "retirement",
  ownerEntityId: null,
};
const ACCT_OTHER_TAXABLE: AccountForDeduction = {
  id: "acct-other-tax",
  subType: "other",
  category: "taxable",
  ownerEntityId: null,
};
const ACCT_ROTH_IRA: AccountForDeduction = {
  id: "acct-roth",
  subType: "roth_ira",
  category: "retirement",
  ownerEntityId: null,
};
const ACCT_BROKERAGE: AccountForDeduction = {
  id: "acct-brk",
  subType: "brokerage",
  category: "taxable",
  ownerEntityId: null,
};

let ruleSeq = 0;
function makeRule(
  accountId: string,
  amount: number,
  startYear = 2026,
  endYear = 2076,
  opts: { isDeductible?: boolean; annualPercent?: number | null; rothPercent?: number | null } = {}
): SavingsRuleForDeduction {
  return {
    id: `rule-${++ruleSeq}`,
    accountId,
    annualAmount: amount,
    annualPercent: opts.annualPercent ?? null,
    isDeductible: opts.isDeductible ?? true,
    rothPercent: opts.rothPercent ?? null,
    startYear,
    endYear,
  };
}

describe("deriveAboveLineFromSavings", () => {
  it("sums traditional IRA contributions", () => {
    const rules = [makeRule("acct-ira", 7500)];
    const result = deriveAboveLineFromSavings(2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways);
    expect(result.aboveLine).toBe(7500);
    expect(result.itemized).toBe(0);
    expect(result.saltPool).toBe(0);
  });

  it("sums 401k contributions", () => {
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-401k", 24500)], [ACCT_401K], isGrantorAlways);
    expect(result.aboveLine).toBe(24500);
  });

  it("sums multiple deductible rules", () => {
    const rules = [makeRule("acct-401k", 24500), makeRule("acct-ira", 7500)];
    const result = deriveAboveLineFromSavings(2026, rules, [ACCT_401K, ACCT_TRADITIONAL_IRA], isGrantorAlways);
    expect(result.aboveLine).toBe(32000);
  });

  it("excludes Roth IRA contributions", () => {
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-roth", 7500)], [ACCT_ROTH_IRA], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes brokerage contributions", () => {
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-brk", 50000)], [ACCT_BROKERAGE], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes pre-startYear contributions", () => {
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-ira", 7500, 2030, 2076)], [ACCT_TRADITIONAL_IRA], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes post-endYear contributions", () => {
    const result = deriveAboveLineFromSavings(2031, [makeRule("acct-ira", 7500, 2026, 2030)], [ACCT_TRADITIONAL_IRA], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes contributions to non-grantor entity accounts", () => {
    const acctEntity: AccountForDeduction = { id: "acct-trust", subType: "traditional_ira", category: "retirement", ownerEntityId: "entity-1" };
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-trust", 7500)], [acctEntity], isGrantorNever);
    expect(result.aboveLine).toBe(0);
  });

  it("includes contributions to grantor entity accounts", () => {
    const acctEntity: AccountForDeduction = { id: "acct-grantor", subType: "traditional_ira", category: "retirement", ownerEntityId: "entity-1" };
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-grantor", 7500)], [acctEntity], isGrantorAlways);
    expect(result.aboveLine).toBe(7500);
  });

  it("returns zero for empty rules", () => {
    const result = deriveAboveLineFromSavings(2026, [], [], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("skips rule whose account is not in accounts list", () => {
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-missing", 7500)], [], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("includes 403b contributions (bug fix — was previously excluded)", () => {
    const result = deriveAboveLineFromSavings(2026, [makeRule("acct-403b", 22500)], [ACCT_403B], isGrantorAlways);
    expect(result.aboveLine).toBe(22500);
  });

  it("includes 'other' retirement contributions when isDeductible is true", () => {
    const rule = makeRule("acct-other-ret", 10000, 2026, 2076, { isDeductible: true });
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_OTHER_RETIREMENT], isGrantorAlways);
    expect(result.aboveLine).toBe(10000);
  });

  it("excludes 'other' retirement contributions when isDeductible is false", () => {
    const rule = makeRule("acct-other-ret", 10000, 2026, 2076, { isDeductible: false });
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_OTHER_RETIREMENT], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes contributions on non-retirement 'other' accounts even when isDeductible is true", () => {
    // UI should never set isDeductible=true on a non-retirement account, but the
    // engine gates on category too as a safety net.
    const rule = makeRule("acct-other-tax", 10000, 2026, 2076, { isDeductible: true });
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_OTHER_TAXABLE], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes 401k contributions when isDeductible is false (post-tax 401k / after-tax contributions)", () => {
    const rule = makeRule("acct-401k", 10000, 2026, 2076, { isDeductible: false });
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_401K], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes traditional IRA contributions when isDeductible is false (non-deductible IRA / backdoor Roth)", () => {
    const rule = makeRule("acct-ira", 7500, 2026, 2076, { isDeductible: false });
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_TRADITIONAL_IRA], isGrantorAlways);
    expect(result.aboveLine).toBe(0);
  });

  it("resolves percent-mode contribution against salaryByRuleId", () => {
    const rule = makeRule("acct-401k", 0, 2026, 2076, { annualPercent: 0.1 });
    const salaryByRuleId: Record<string, number> = { [rule.id]: 150000 };
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_401K], isGrantorAlways, salaryByRuleId);
    expect(result.aboveLine).toBeCloseTo(15000, 0);
  });

  it("percent-mode contribution with zero salary resolves to zero", () => {
    const rule = makeRule("acct-401k", 0, 2026, 2076, { annualPercent: 0.1 });
    const salaryByRuleId: Record<string, number> = { [rule.id]: 0 };
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_401K], isGrantorAlways, salaryByRuleId);
    expect(result.aboveLine).toBe(0);
  });

  it("falls back to annualAmount when salaryByRuleId is not provided", () => {
    const rule = makeRule("acct-401k", 23500);
    const result = deriveAboveLineFromSavings(2026, [rule], [ACCT_401K], isGrantorAlways);
    expect(result.aboveLine).toBe(23500);
  });

  it("deducts only the pre-tax portion of a split 401(k) rule", () => {
    const rule = makeRule("acct-401k", 10000, 2026, 2035, { rothPercent: 0.4 });
    const result = deriveAboveLineFromSavings(
      2026, [rule], [ACCT_401K], isGrantorAlways,
    );
    // 60% pre-tax of 10,000
    expect(result.aboveLine).toBe(6000);
  });

  it("a fully-Roth 401(k) rule produces no deduction", () => {
    const rule = makeRule("acct-401k", 10000, 2026, 2035, { rothPercent: 1 });
    const result = deriveAboveLineFromSavings(
      2026, [rule], [ACCT_401K], isGrantorAlways,
    );
    expect(result.aboveLine).toBe(0);
  });
});

// ── sumItemizedFromEntries (v2 enum) ────────────────────────────────────────

function makeRow(type: ClientDeductionRow["type"], amount: number, growth = 0, startYear = 2026, endYear = 2076): ClientDeductionRow {
  return { type, annualAmount: amount, growthRate: growth, startYear, endYear };
}

describe("sumItemizedFromEntries", () => {
  it("returns zero contribution for empty rows", () => {
    const result = sumItemizedFromEntries(2026, []);
    expect(result.aboveLine).toBe(0);
    expect(result.itemized).toBe(0);
    expect(result.saltPool).toBe(0);
  });

  it("sums a charitable row into itemized", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("charitable", 25000)]);
    expect(result.itemized).toBe(25000);
    expect(result.saltPool).toBe(0);
  });

  it("inflates a charitable row by growth rate", () => {
    const result = sumItemizedFromEntries(2030, [makeRow("charitable", 25000, 0.02)]);
    expect(result.itemized).toBeCloseTo(27060.8, 1);
  });

  it("routes property_tax rows to saltPool", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("property_tax", 15000)]);
    expect(result.saltPool).toBe(15000);
    expect(result.itemized).toBe(0);
  });

  it("routes above_line rows to aboveLine", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("above_line", 5000)]);
    expect(result.aboveLine).toBe(5000);
    expect(result.itemized).toBe(0);
  });

  it("routes below_line rows to itemized", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("below_line", 8000)]);
    expect(result.itemized).toBe(8000);
  });

  it("excludes pre-startYear rows", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("charitable", 25000, 0, 2030, 2076)]);
    expect(result.itemized).toBe(0);
  });

  it("excludes post-endYear rows", () => {
    const result = sumItemizedFromEntries(2031, [makeRow("charitable", 25000, 0, 2026, 2030)]);
    expect(result.itemized).toBe(0);
  });

  it("computes growth independently per row", () => {
    const rows = [makeRow("charitable", 10000, 0.05, 2026), makeRow("charitable", 5000, 0.03, 2028)];
    const result = sumItemizedFromEntries(2030, rows);
    expect(result.itemized).toBeCloseTo(12155.0625 + 5304.5, 2);
  });
});

// ── Expense deduction helpers ───────────────────────────────────────────────

function makeExpense(
  deductionType: ExpenseForDeduction["deductionType"],
  amount: number,
  startYear = 2026,
  endYear = 2076,
  growthRate = 0,
  inflationStartYear?: number,
): ExpenseForDeduction {
  return { deductionType, annualAmount: amount, startYear, endYear, growthRate, inflationStartYear };
}

describe("deriveAboveLineFromExpenses", () => {
  it("sums expenses tagged above_line", () => {
    const result = deriveAboveLineFromExpenses(2026, [makeExpense("above_line", 5000)]);
    expect(result.aboveLine).toBe(5000);
  });

  it("excludes expenses tagged charitable", () => {
    const result = deriveAboveLineFromExpenses(2026, [makeExpense("charitable", 10000)]);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes expenses outside year range", () => {
    const result = deriveAboveLineFromExpenses(2025, [makeExpense("above_line", 5000)]);
    expect(result.aboveLine).toBe(0);
  });

  it("returns zero for no tagged expenses", () => {
    const result = deriveAboveLineFromExpenses(2026, [makeExpense(null, 10000)]);
    expect(result.aboveLine).toBe(0);
  });
});

describe("deriveItemizedFromExpenses", () => {
  it("routes charitable to itemized", () => {
    const result = deriveItemizedFromExpenses(2026, [makeExpense("charitable", 12000)]);
    expect(result.itemized).toBe(12000);
    expect(result.saltPool).toBe(0);
  });

  it("routes below_line to itemized", () => {
    const result = deriveItemizedFromExpenses(2026, [makeExpense("below_line", 8000)]);
    expect(result.itemized).toBe(8000);
  });

  it("routes property_tax to saltPool", () => {
    const result = deriveItemizedFromExpenses(2026, [makeExpense("property_tax", 3000)]);
    expect(result.saltPool).toBe(3000);
    expect(result.itemized).toBe(0);
  });

  it("separates mixed tagged expenses into correct buckets", () => {
    const exps = [
      makeExpense("charitable", 10000),
      makeExpense("property_tax", 5000),
      makeExpense("below_line", 3000),
    ];
    const result = deriveItemizedFromExpenses(2026, exps);
    expect(result.itemized).toBe(13000);
    expect(result.saltPool).toBe(5000);
  });

  it("applies growth rate from inflationStartYear", () => {
    // $10k, 3% growth, inflationStartYear=2024, year=2026 → 2 years of growth
    // 10000 * 1.03^2 = 10609
    const result = deriveItemizedFromExpenses(2026, [makeExpense("charitable", 10000, 2026, 2076, 0.03, 2024)]);
    expect(result.itemized).toBeCloseTo(10609, 0);
  });
});

// ── Mortgage interest helper ────────────────────────────────────────────────

function makeLiab(
  id: string,
  isInterestDeductible: boolean,
  startYear = 2026,
  endYear = 2056,
): LiabilityForDeduction {
  return { id, isInterestDeductible, startYear, endYear };
}

describe("deriveMortgageInterestFromLiabilities", () => {
  it("includes interest from deductible liabilities", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2026, [makeLiab("liab-1", true)], { "liab-1": 18000 },
    );
    expect(result.itemized).toBe(18000);
  });

  it("excludes non-deductible liabilities", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2026, [makeLiab("liab-1", false)], { "liab-1": 18000 },
    );
    expect(result.itemized).toBe(0);
  });

  it("excludes liabilities outside year range", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2025, [makeLiab("liab-1", true)], { "liab-1": 18000 },
    );
    expect(result.itemized).toBe(0);
  });

  it("sums multiple deductible liabilities", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2026, [makeLiab("liab-1", true), makeLiab("liab-2", true)], { "liab-1": 18000, "liab-2": 5000 },
    );
    expect(result.itemized).toBe(23000);
  });
});

// ── Property tax from accounts ──────────────────────────────────────────────

function makeREAccount(
  id: string,
  annualPropertyTax: number,
  growthRate = 0.03,
  category: "real_estate" | "taxable" = "real_estate",
): AccountForPropertyTax {
  return { id, name: `Property ${id}`, category, annualPropertyTax, propertyTaxGrowthRate: growthRate };
}

describe("derivePropertyTaxFromAccounts", () => {
  it("returns inflated property tax for real estate accounts", () => {
    const result = derivePropertyTaxFromAccounts(2026, [makeREAccount("re-1", 12000)], 2026);
    expect(result.saltPool).toBe(12000);
  });

  it("excludes non-real-estate accounts", () => {
    const result = derivePropertyTaxFromAccounts(2026, [makeREAccount("brk", 5000, 0.03, "taxable")], 2026);
    expect(result.saltPool).toBe(0);
  });

  it("applies growth rate year-over-year from planStartYear", () => {
    // 12000 * 1.03^2 = 12730.80
    const result = derivePropertyTaxFromAccounts(2028, [makeREAccount("re-1", 12000, 0.03)], 2026);
    expect(result.saltPool).toBeCloseTo(12730.8, 0);
  });

  it("excludes accounts with zero property tax", () => {
    const result = derivePropertyTaxFromAccounts(2026, [makeREAccount("re-1", 0)], 2026);
    expect(result.saltPool).toBe(0);
  });
});

// ── SALT cap + aggregation ──────────────────────────────────────────────────

describe("saltCap", () => {
  it("returns 40000 for 2026+", () => {
    expect(saltCap(2026)).toBe(40000);
    expect(saltCap(2030)).toBe(40000);
    expect(saltCap(2050)).toBe(40000);
  });

  it("returns 10000 for pre-2026", () => {
    expect(saltCap(2025)).toBe(10000);
    expect(saltCap(2020)).toBe(10000);
  });
});

describe("aggregateDeductions", () => {
  it("sums all buckets and caps SALT at $40k for 2026", () => {
    const c1: DeductionContribution = { aboveLine: 10000, itemized: 5000, saltPool: 25000 };
    const c2: DeductionContribution = { aboveLine: 5000, itemized: 3000, saltPool: 20000 };
    const result = aggregateDeductions(2026, c1, c2);
    expect(result.aboveLine).toBe(15000);
    // SALT: 45000 capped at 40000 + itemized 8000 = 48000
    expect(result.itemized).toBe(48000);
  });

  it("caps SALT at $10k for pre-2026", () => {
    const c: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 25000 };
    const result = aggregateDeductions(2025, c);
    expect(result.itemized).toBe(10000);
  });

  it("does not inflate the cap", () => {
    const c: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 50000 };
    expect(aggregateDeductions(2050, c).itemized).toBe(40000);
  });

  it("passes through SALT under the cap unchanged", () => {
    const c: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 15000 };
    expect(aggregateDeductions(2026, c).itemized).toBe(15000);
  });

  it("aggregates mixed sources before applying single cap", () => {
    const manual: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 10000 };
    const expense: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 15000 };
    const account: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 20000 };
    const result = aggregateDeductions(2026, manual, expense, account);
    expect(result.itemized).toBe(40000);
  });
});
