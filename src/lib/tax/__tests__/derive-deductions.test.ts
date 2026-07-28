import { describe, it, expect } from "vitest";
import {
  deriveAboveLineFromSavings,
  sumItemizedFromEntries,
  deriveAboveLineFromExpenses,
  deriveItemizedFromExpenses,
  deriveMortgageInterestFromLiabilities,
  deriveStudentLoanInterest,
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
import type { FilingStatus, TaxYearParameters } from "../types";
import type { LiabilityType } from "@/engine/liability-kind";

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

describe("deriveAboveLineFromSavings — HSA", () => {
  const noEntity = () => true;
  const hsaAcct: AccountForDeduction[] = [
    { id: "h1", subType: "hsa", category: "retirement" },
  ];

  it("deducts an HSA contribution even when the rule isDeductible flag is false", () => {
    const rules: SavingsRuleForDeduction[] = [
      {
        id: "r1",
        accountId: "h1",
        annualAmount: 4000,
        isDeductible: false,
        startYear: 2020,
        endYear: 2099,
      },
    ];
    const res = deriveAboveLineFromSavings(2026, rules, hsaAcct, noEntity);
    expect(res.aboveLine).toBe(4000);
  });

  it("reflects the capped amount when an override is supplied", () => {
    const rules: SavingsRuleForDeduction[] = [
      {
        id: "r1",
        accountId: "h1",
        annualAmount: 6000,
        isDeductible: false,
        startYear: 2020,
        endYear: 2099,
      },
    ];
    const res = deriveAboveLineFromSavings(2026, rules, hsaAcct, noEntity, undefined, {
      r1: 4400,
    });
    expect(res.aboveLine).toBe(4400);
  });
});

// ── Traditional-IRA MAGI gate ───────────────────────────────────────────────

describe("deriveAboveLineFromSavings — traditional IRA MAGI gate", () => {
  // MFJ covered 129,000-149,000 (width 20,000); single covered 81,000-91,000
  // (width 10,000); MFJ spousal 242,000-252,000.
  const gateParams = {
    iraDeduct: {
      coveredStartMfj: 129000, coveredEndMfj: 149000,
      coveredStartSingle: 81000, coveredEndSingle: 91000,
      spousalStartMfj: 242000, spousalEndMfj: 252000,
    },
  } as unknown as TaxYearParameters;

  /** Default: MFJ, self covered, MAGI above the top of the covered range. */
  const gate = (
    over: Partial<{ magi: number; coveredSelf: boolean; coveredSpouse: boolean; filingStatus: FilingStatus }> = {}
  ) => ({
    magi: 200000,
    coveredSelf: true,
    coveredSpouse: false,
    params: gateParams,
    filingStatus: "married_joint" as FilingStatus,
    ...over,
  });

  const ACCT_HSA: AccountForDeduction = {
    id: "acct-hsa", subType: "hsa", category: "retirement", ownerEntityId: null,
  };

  it("zeroes the deduction for a covered contributor above the range", () => {
    const rules = [makeRule("acct-ira", 7500)];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways, undefined, undefined, gate(),
    );
    // MAGI 200,000 >= 149,000 -> fully phased out.
    expect(res.aboveLine).toBe(0);
  });

  it("leaves a 401(k) rule untouched at the same MAGI", () => {
    const rules = [makeRule("acct-401k", 24500), makeRule("acct-ira", 7500)];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_401K, ACCT_TRADITIONAL_IRA], isGrantorAlways, undefined, undefined, gate(),
    );
    // The IRA's 7,500 is gated away; the 401(k) deferral is never MAGI-limited.
    expect(res.aboveLine).toBe(24500);
  });

  it("leaves 403(b), HSA and 'other' retirement rules untouched at the same MAGI", () => {
    const rules = [
      makeRule("acct-403b", 22500),
      makeRule("acct-hsa", 4000),
      makeRule("acct-other-ret", 10000),
    ];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_403B, ACCT_HSA, ACCT_OTHER_RETIREMENT], isGrantorAlways,
      undefined, undefined, gate(),
    );
    expect(res.aboveLine).toBe(36500);
  });

  it("does not gate at all when iraGate is omitted", () => {
    const rules = [makeRule("acct-ira", 7500)];
    const res = deriveAboveLineFromSavings(2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways);
    expect(res.aboveLine).toBe(7500);
  });

  it("aggregates traditional IRA rules so Pub 590-A rounding applies once", () => {
    // MAGI 147,750 -> fraction 18,750/20,000 = 0.9375, so 6.25% survives.
    // Aggregated: 6,000 x 0.0625 = 375 -> rounded up to 380.
    // Per-rule would be 2,000 x 0.0625 = 125 -> floored to 200 each = 600.
    const rules = [
      makeRule("acct-ira", 2000),
      makeRule("acct-ira", 2000),
      makeRule("acct-ira", 2000),
    ];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways,
      undefined, undefined, gate({ magi: 147750 }),
    );
    expect(res.aboveLine).toBe(380);
  });

  it("gates the pre-tax portion of a split rule, not the gross contribution", () => {
    // 10,000 with rothPercent 0.4 -> 6,000 pre-tax.
    // 6,000 x 0.0625 = 375 -> 380. Gating the gross 10,000 would give 630.
    const rules = [makeRule("acct-ira", 10000, 2026, 2076, { rothPercent: 0.4 })];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways,
      undefined, undefined, gate({ magi: 147750 }),
    );
    expect(res.aboveLine).toBe(380);
  });

  it("never deducts more than the pre-tax portion below the range", () => {
    const rules = [makeRule("acct-ira", 10000, 2026, 2076, { rothPercent: 0.4 })];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways,
      undefined, undefined, gate({ magi: 100000 }),
    );
    // Below 129,000 the full contribution is deductible — but "full" is the
    // 6,000 pre-tax portion, never the 10,000 gross.
    expect(res.aboveLine).toBe(6000);
  });

  it("does not gate when neither spouse is a covered participant", () => {
    const rules = [makeRule("acct-ira", 7500)];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways, undefined, undefined,
      gate({ magi: 5000000, coveredSelf: false, coveredSpouse: false }),
    );
    expect(res.aboveLine).toBe(7500);
  });

  it("applies the spousal range when only the spouse is covered", () => {
    const rules = [makeRule("acct-ira", 7500)];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways, undefined, undefined,
      gate({ magi: 200000, coveredSelf: false, coveredSpouse: true }),
    );
    // 200,000 is below the spousal range's 242,000 start — full deduction.
    // Reading the flags in the wrong order would apply the covered range and
    // zero this out.
    expect(res.aboveLine).toBe(7500);
  });

  it("uses the caller's filing status for the range", () => {
    const rules = [makeRule("acct-ira", 7500)];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways, undefined, undefined,
      gate({ magi: 86000, filingStatus: "single" }),
    );
    // Single range 81,000-91,000: halfway through -> 7,500 x 0.5 = 3,750.
    // Under the MFJ range this MAGI would be fully deductible.
    expect(res.aboveLine).toBe(3750);
  });

  it("never reaches the gate for a rule the existing guards already skip", () => {
    // isDeductible=false at a MAGI the gate would otherwise pass through in
    // full — the rule must not reach the traditional-IRA accumulator.
    const rules = [makeRule("acct-ira", 7500, 2026, 2076, { isDeductible: false })];
    const res = deriveAboveLineFromSavings(
      2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways, undefined, undefined,
      gate({ magi: 100000 }),
    );
    expect(res.aboveLine).toBe(0);
  });
});

// ── Student-loan interest (above-line) ──────────────────────────────────────

describe("deriveStudentLoanInterest", () => {
  // MFJ 170,000-200,000 (width 30,000); single 85,000-100,000 (width 15,000).
  // Every MAGI below is picked so (magi - start) / (end - start) lands on an
  // exactly-representable binary64 fraction, making the expected dollar
  // figures exact rather than nearly-exact.
  const slParams = {
    studentLoan: {
      maxDeduction: 2500,
      startMfj: 170000, endMfj: 200000,
      startSingle: 85000, endSingle: 100000,
    },
  } as unknown as TaxYearParameters;

  const noCapParams = {
    studentLoan: {
      maxDeduction: null,
      startMfj: 170000, endMfj: 200000,
      startSingle: 85000, endSingle: 100000,
    },
  } as unknown as TaxYearParameters;

  const loan = (id: string, liabilityType: LiabilityType | null) => ({ id, liabilityType });

  it("counts interest from student liabilities only", () => {
    const res = deriveStudentLoanInterest(
      2026,
      [loan("mtg", "mortgage"), loan("sl", "student")],
      { mtg: 9000, sl: 1200 },
      100000, slParams, "married_joint",
    );
    // The 9,000 of mortgage interest belongs to the itemized path — it must not
    // leak into the above-line figure, nor must any of this land in itemized.
    expect(res).toEqual({ aboveLine: 1200, itemized: 0, saltPool: 0 });
  });

  it("ignores a legacy liability carrying no type", () => {
    const res = deriveStudentLoanInterest(
      2026, [loan("legacy", null)], { legacy: 2000 }, 100000, slParams, "married_joint",
    );
    expect(res.aboveLine).toBe(0);
  });

  it("treats a student loan missing from the interest map as zero interest", () => {
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], {}, 100000, slParams, "married_joint",
    );
    // Not NaN: a liability with no accrual entry contributes nothing.
    expect(res.aboveLine).toBe(0);
  });

  it("denies the deduction to a married-filing-separately filer", () => {
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], { sl: 2000 }, 50000, slParams, "married_separate",
    );
    // IRC 221(e)(2): disallowed outright, even at a MAGI far below the range.
    expect(res.aboveLine).toBe(0);
  });

  it("deducts the full interest below the phase-out range", () => {
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], { sl: 1800 }, 100000, slParams, "married_joint",
    );
    expect(res.aboveLine).toBe(1800);
  });

  it("reduces the deduction linearly inside the phase-out range", () => {
    // MAGI 185,000 -> 15,000/30,000 = 0.5 exactly, so half survives.
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], { sl: 2000 }, 185000, slParams, "married_joint",
    );
    expect(res.aboveLine).toBe(1000);
  });

  it("zeroes the deduction at the top of the range", () => {
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], { sl: 2000 }, 200000, slParams, "married_joint",
    );
    expect(res.aboveLine).toBe(0);
  });

  it("uses the caller's filing status to pick the range", () => {
    // Single 85,000-100,000: MAGI 92,500 -> 7,500/15,000 = 0.5 exactly.
    // Under the MFJ range the same MAGI would be fully deductible.
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], { sl: 2000 }, 92500, slParams, "single",
    );
    expect(res.aboveLine).toBe(1000);
  });

  it("applies the maxDeduction cap BEFORE the phase-out", () => {
    // 4,000 paid -> capped to 2,500 -> x 0.5 = 1,250. Capping after the
    // phase-out instead would yield min(4,000 x 0.5, 2,500) = 2,000.
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], { sl: 4000 }, 185000, slParams, "married_joint",
    );
    expect(res.aboveLine).toBe(1250);
  });

  it("treats a null maxDeduction as no cap, not as zero", () => {
    const res = deriveStudentLoanInterest(
      2026, [loan("sl", "student")], { sl: 3000 }, 100000, noCapParams, "married_joint",
    );
    expect(res.aboveLine).toBe(3000);
  });

  it("caps the household's student loans once, not once per loan", () => {
    // 3 x 1,200 = 3,600 of interest against ONE $2,500 per-return cap.
    // Calling the helper per liability would cap each at 2,500 and return 3,600.
    const res = deriveStudentLoanInterest(
      2026,
      [loan("sl-1", "student"), loan("sl-2", "student"), loan("sl-3", "student")],
      { "sl-1": 1200, "sl-2": 1200, "sl-3": 1200 },
      100000, slParams, "married_joint",
    );
    expect(res.aboveLine).toBe(2500);
  });
});
