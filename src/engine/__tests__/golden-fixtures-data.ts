/**
 * Golden fixture inputs and expected-year tables for four canonical
 * projection scenarios (audit F5 baselines).
 *
 * G1 — Pre-retirement, no deficit
 *   Client + spouse still working 2026-2035; income > expenses every year;
 *   gap-fill never fires.
 *
 * G2 — Early retiree, taxable + Roth basis deficit, pre-59.5
 *   Both retired (age 50/48 in 2026); deficit covered by brokerage then
 *   Roth-basis pulls.
 *
 * G3 — Late retiree, Trad IRA deficit + RMDs, post-72
 *   Both retired (age 75/73 in 2026); RMDs from 401k + deficit draws.
 *
 * G4 — Split 401(k) savings rule, Roth/pre-tax
 *   Single filer still working 2026-2027; 401(k) rule has rothPercent=0.3;
 *   bracket mode confirms Roth basis grows at 30% of contribution and the
 *   above-the-line deduction counts only the 70% pre-tax slice.
 *
 * NOTE on PR2 (audit F5): the underlying `sampleAccounts` fixture has no
 * `isDefaultChecking: true` account, so all three goldens currently
 * exercise the legacy no-checking branch (`projection.ts:else { ... }`).
 * The new iterative convergence loop covers the with-checking path only and
 * is regression-tested by `projection-gap-fill-iterative.test.ts` (cases
 * a-h). Updating these goldens to add a default-checking account would
 * change every captured number wholesale — deferred (see future-work/engine.md
 * "Default-checking variant of golden fixtures G2/G3").
 */

import type { ClientData, PlanSettings, TaxYearParameters } from "../types";
import {
  baseClient,
  basePlanSettings,
  sampleAccounts,
  sampleIncomes,
  sampleExpenses,
  sampleSavingsRules,
  sampleFamilyMembers,
} from "./fixtures";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ─── G1: Pre-retirement, no deficit ─────────────────────────────────────────

export const g1PlanSettings: PlanSettings = basePlanSettings;

export const g1ClientData: ClientData = {
  // Default baseClient: DOB 1970-01-01 → age 56 in 2026; spouse 1972-06-15 → age 54.
  // Salary income 2026-2035 ($150k + $100k), SS from 2026. Expenses $80k+$5k.
  // No mortgage — keeps the scenario clean.
  client: baseClient,
  accounts: sampleAccounts,
  incomes: sampleIncomes,
  expenses: sampleExpenses,
  liabilities: [],
  savingsRules: sampleSavingsRules,
  withdrawalStrategy: [
    { accountId: "acct-savings",   priorityOrder: 1, startYear: 2026, endYear: 2055 },
    { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
    { accountId: "acct-401k",      priorityOrder: 3, startYear: 2026, endYear: 2055 },
    { accountId: "acct-roth",      priorityOrder: 4, startYear: 2026, endYear: 2055 },
  ],
  planSettings: g1PlanSettings,
  familyMembers: sampleFamilyMembers,
  giftEvents: [],
};

// ─── G2: Early retiree, taxable + Roth basis deficit ────────────────────────

export const g2PlanSettings: PlanSettings = basePlanSettings;

export const g2ClientData: ClientData = {
  // Client DOB 1976-01-01 → age 50 in 2026 (pre-59.5 penalty zone).
  // No salary; cash exhausted year 1; deficit hits brokerage then Roth basis.
  // Home excluded so the portfolio is clean liquidation candidates only.
  client: {
    ...baseClient,
    dateOfBirth: "1976-01-01",
    spouseDob: "1978-01-01",
  },
  accounts: sampleAccounts.filter((a) => a.id !== "acct-home"),
  incomes: [],
  expenses: sampleExpenses,
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [
    { accountId: "acct-savings",   priorityOrder: 1, startYear: 2026, endYear: 2055 },
    { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
    { accountId: "acct-roth",      priorityOrder: 3, startYear: 2026, endYear: 2055 },
    { accountId: "acct-401k",      priorityOrder: 4, startYear: 2026, endYear: 2055 },
  ],
  planSettings: g2PlanSettings,
  familyMembers: sampleFamilyMembers,
  giftEvents: [],
};

// ─── G3: Late retiree, Trad IRA deficit + RMDs ──────────────────────────────

export const g3PlanSettings: PlanSettings = basePlanSettings;

export const g3ClientData: ClientData = {
  // Client DOB 1951-01-01 → age 75 in 2026 (past RMD age).
  // SS only; 401k rmdEnabled triggers RMDs; savings exhausted early.
  client: {
    ...baseClient,
    dateOfBirth: "1951-01-01",
    spouseDob: "1953-01-01",
  },
  accounts: sampleAccounts.filter(
    (a) => a.id === "acct-401k" || a.id === "acct-savings",
  ),
  incomes: [
    {
      id: "inc-ss-john-g3",
      type: "social_security",
      name: "John SS",
      annualAmount: 36_000,
      startYear: 2026,
      endYear: 2055,
      growthRate: 0.02,
      owner: "client",
      claimingAge: 67,
    },
  ],
  expenses: sampleExpenses,
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [
    { accountId: "acct-savings", priorityOrder: 1, startYear: 2026, endYear: 2055 },
    { accountId: "acct-401k",    priorityOrder: 2, startYear: 2026, endYear: 2055 },
  ],
  planSettings: g3PlanSettings,
  familyMembers: [
    {
      id: LEGACY_FM_CLIENT,
      role: "client",
      relationship: "other",
      firstName: "John",
      lastName: "Smith",
      dateOfBirth: "1951-01-01",
    },
    {
      id: LEGACY_FM_SPOUSE,
      role: "spouse",
      relationship: "other",
      firstName: "Jane",
      lastName: "Smith",
      dateOfBirth: "1953-01-01",
    },
  ],
  giftEvents: [],
};

// ─── G4: Split 401(k) savings rule, Roth/pre-tax ────────────────────────────

/** Minimal bracket-mode tax year parameters used by G4 only. */
const g4TaxYearRow: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [
      { from: 0, to: 24800, rate: 0.10 },
      { from: 24800, to: 100800, rate: 0.12 },
      { from: 100800, to: null, rate: 0.22 },
    ],
    single: [{ from: 0, to: null, rate: 0.10 }],
    head_of_household: [{ from: 0, to: null, rate: 0.10 }],
    married_separate: [{ from: 0, to: null, rate: 0.10 }],
  },
  capGainsBrackets: {
    married_joint: { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single: { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [],
  trustCapGainsBrackets: [],
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
};

export const g4PlanSettings: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2027,
  // Bracket mode required so the above-the-line deduction path runs and
  // rothPercent's effect on the deduction is observable in the output.
  taxEngineMode: "bracket",
};

export const g4ClientData: ClientData = {
  // Single filer, age 46 in 2026; salary $80k/yr flat; one 401(k) account
  // starting at $100k with rothValue: 0. Savings rule contributes $10k/yr
  // with rothPercent: 0.3 — 30% Roth, 70% pre-tax.
  client: {
    ...baseClient,
    filingStatus: "single",
    spouseName: undefined,
    spouseDob: undefined,
    spouseRetirementAge: undefined,
    dateOfBirth: "1980-01-01",
    retirementAge: 65,
    planEndAge: 90,
  },
  accounts: [
    {
      id: "acct-g4-401k",
      name: "Alex 401(k)",
      category: "retirement",
      subType: "401k",
      value: 100_000,
      rothValue: 0,
      basis: 100_000,
      growthRate: 0.07,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    },
  ],
  incomes: [
    {
      id: "inc-g4-salary",
      type: "salary",
      name: "Alex Salary",
      annualAmount: 80_000,
      startYear: 2026,
      endYear: 2027,
      growthRate: 0,
      owner: "client",
    },
  ],
  expenses: [],
  liabilities: [],
  savingsRules: [
    {
      id: "sav-g4-401k",
      accountId: "acct-g4-401k",
      annualAmount: 10_000,
      isDeductible: true,
      // 30% Roth / 70% pre-tax split — the key variable under test.
      rothPercent: 0.3,
      startYear: 2026,
      endYear: 2027,
    },
  ],
  withdrawalStrategy: [],
  planSettings: g4PlanSettings,
  familyMembers: [
    {
      id: LEGACY_FM_CLIENT,
      role: "client",
      relationship: "other",
      firstName: "Alex",
      lastName: "Roth",
      dateOfBirth: "1980-01-01",
    },
  ],
  giftEvents: [],
  // Bracket-mode tax year rows — same fixture data used in projection.test.ts.
  taxYearRows: [
    g4TaxYearRow,
    { ...g4TaxYearRow, year: 2027 },
  ],
};

// ─── Expected-year tables (captured from runProjection, 2026-04-29) ──────────
// These are the locked baselines. PR2 will update G2/G3 numbers.

export interface GoldenExpectedYear {
  year: number;
  expensesTaxes: number;
  withdrawalsTotal: number;
  /** Salary/wage income classified as earnedIncome in taxDetail (G1 only). */
  taxDetailEarned: number;
  /** Ordinary income (SS + Trad-IRA draws) in taxDetail (G3). */
  taxDetailOrdinary: number;
  taxDetailCapGains: number;
  /**
   * For G4 only: Roth-designated portion of the 401(k) balance at end of year.
   * Verifies that rothPercent (0.3) correctly grows the Roth basis each year.
   * Optional — absent for G1/G2/G3 which predate the Roth-split feature.
   */
  rothValueEoY401k?: number;
  /**
   * For G4 only: above-the-line retirement contribution deduction amount.
   * Verifies that only the pre-tax slice (70%) is deducted, not the full
   * contribution. Requires bracket mode to populate deductionBreakdown.
   * Optional — absent for G1/G2/G3 which use flat-mode tax.
   */
  aboveLineRetirementContributions?: number;
}

// G1: flat-rate tax on $250k earned income; no withdrawals needed 2026-2030.
// expensesTaxes = (salaries × 0.27 flat + state); withdrawalsTotal = 0.
export const g1ExpectedYears: GoldenExpectedYear[] = [
  { year: 2026, expensesTaxes: 67500,          withdrawalsTotal: 0, taxDetailEarned: 250000,     taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2027, expensesTaxes: 69525,          withdrawalsTotal: 0, taxDetailEarned: 257500,     taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2028, expensesTaxes: 71610.75,       withdrawalsTotal: 0, taxDetailEarned: 265225,     taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2029, expensesTaxes: 73759.07250000001, withdrawalsTotal: 0, taxDetailEarned: 273181.75, taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2030, expensesTaxes: 75971.844675,   withdrawalsTotal: 0, taxDetailEarned: 281377.2025, taxDetailOrdinary: 0, taxDetailCapGains: 0 },
];

// G2: brokerage + Roth basis pulls cover deficit. Legacy no-checking branch:
// `executeWithdrawals` runs without categorization, so cap gains aren't recognized
// and expensesTaxes stays 0. The new iterative convergence loop (audit F5) does
// recognize gains, but it's gated on `hasChecking` and this fixture has no
// default-checking account.
export const g2ExpectedYears: GoldenExpectedYear[] = [
  { year: 2026, expensesTaxes: 0, withdrawalsTotal: 85000,            taxDetailEarned: 0, taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2027, expensesTaxes: 0, withdrawalsTotal: 87500,            taxDetailEarned: 0, taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2028, expensesTaxes: 0, withdrawalsTotal: 90074,            taxDetailEarned: 0, taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2029, expensesTaxes: 0, withdrawalsTotal: 92724.20000000001, taxDetailEarned: 0, taxDetailOrdinary: 0, taxDetailCapGains: 0 },
  { year: 2030, expensesTaxes: 0, withdrawalsTotal: 95452.8656,       taxDetailEarned: 0, taxDetailOrdinary: 0, taxDetailCapGains: 0 },
];

// G3: RMDs + deficit draws from Trad 401k produce ordinary income; SS partial
// tax. Legacy no-checking branch: same caveat as G2 — the new convergence loop
// is gated on hasChecking and isn't exercised by this fixture.
export const g3ExpectedYears: GoldenExpectedYear[] = [
  { year: 2026, expensesTaxes: 5487.80487804878,    withdrawalsTotal: 34162.60162601626,  taxDetailEarned: 0, taxDetailOrdinary: 20325.20325203252,  taxDetailCapGains: 0 },
  { year: 2027, expensesTaxes: 5863.3837604198825,  withdrawalsTotal: 34927.14761071661,  taxDetailEarned: 0, taxDetailOrdinary: 21716.23614970327,  taxDetailCapGains: 0 },
  { year: 2028, expensesTaxes: 6043.8679750475585,  withdrawalsTotal: 36278.77177116771,  taxDetailEarned: 0, taxDetailOrdinary: 22384.696203879845, taxDetailCapGains: 0 },
  { year: 2029, expensesTaxes: 6011.534574514884,   withdrawalsTotal: 38267.303705941245, taxDetailEarned: 0, taxDetailOrdinary: 22264.942868573646, taxDetailCapGains: 0 },
  { year: 2030, expensesTaxes: 5932.1240430787375,  withdrawalsTotal: 40446.60209389824,  taxDetailEarned: 0, taxDetailOrdinary: 21970.82978918051,  taxDetailCapGains: 0 },
];

// G4: Bracket-mode, single filer, salary $80k, 401(k) $10k/yr at rothPercent=0.3.
//
// Key invariants per year (rothPercent = 0.3, contribution = $10,000):
//   rothValueEoY401k = priorRothValue × 1.07 + 0.3 × 10_000
//     year 2026: 0 × 1.07 + 3_000 = 3_000
//     year 2027: 3_000 × 1.07 + 3_000 = 3_210 + 3_000 = 6_210
//   aboveLineRetirementContributions = 0.7 × 10_000 = 7_000 (pre-tax slice only)
//
// expensesTaxes: bracket engine on ($80k salary − $7k above-line − $15k std deduction)
//   + FICA. Locked from first runProjection pass (2026-05-15).
export const g4ExpectedYears: GoldenExpectedYear[] = [
  {
    year: 2026,
    expensesTaxes: 14820,
    withdrawalsTotal: 0,
    taxDetailEarned: 80_000,
    taxDetailOrdinary: 0,
    taxDetailCapGains: 0,
    // Roth basis = 30% of $10,000 contribution (year 1: starting from 0).
    rothValueEoY401k: 3_000,
    // Deduction = 70% of $10,000 (pre-tax slice only — Roth slice is excluded).
    aboveLineRetirementContributions: 7_000,
  },
  {
    year: 2027,
    expensesTaxes: 14820,
    withdrawalsTotal: 0,
    taxDetailEarned: 80_000,
    taxDetailOrdinary: 0,
    taxDetailCapGains: 0,
    // Roth basis grows: $3,000 × 1.07 + $3,000 = $6,210.
    rothValueEoY401k: 6_210,
    aboveLineRetirementContributions: 7_000,
  },
];
