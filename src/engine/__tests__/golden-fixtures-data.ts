/**
 * Golden fixture inputs and expected-year tables for three canonical
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
 * NOTE on PR2 (audit F5): the underlying `sampleAccounts` fixture has no
 * `isDefaultChecking: true` account, so all three goldens currently
 * exercise the legacy no-checking branch (`projection.ts:else { ... }`).
 * The new iterative convergence loop covers the with-checking path only and
 * is regression-tested by `projection-gap-fill-iterative.test.ts` (cases
 * a-h). Updating these goldens to add a default-checking account would
 * change every captured number wholesale — deferred (see future-work/engine.md
 * "Default-checking variant of golden fixtures G2/G3").
 */

import type { ClientData, PlanSettings } from "../types";
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
