/**
 * netCashFlow must include note-receivable cash inflows.
 *
 * Before the fix: notes-receivable principal+interest were credited directly to
 * the owner's checking account but were NOT folded into income.total /
 * totalIncome / netCashFlow. The on-screen cash flow report patched Total
 * Income with a `+ noteTotal(r)` workaround, but the Net Cash Flow column kept
 * showing raw `r.netCashFlow`, so it didn't reconcile (Total Income –
 * Total Expenses ≠ Net Cash Flow). This test pins the engine-side fix.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  NoteReceivable,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

const planSettings: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2026,
};

const client = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint" as const,
  spouseName: "Bob Test",
  spouseDob: "1980-06-01",
  spouseRetirementAge: 65,
};

const hhChecking: Account = {
  id: "hh-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
  isDefaultChecking: true,
};

/** $100k 5% amortizing note over 12 months — pays off entirely in plan year 2026.
 *  Cash inflow = full faceValue + first-year interest. Set basis = faceValue so
 *  there's no LTCG component; payments are interest + principal-basis only. */
const note: NoteReceivable = {
  id: "note-1",
  name: "Note from sale",
  faceValue: 100_000,
  basis: 100_000,
  interestRate: 0.05,
  paymentType: "amortizing",
  startYear: 2026,
  startMonth: 1,
  termMonths: 12,
  extraPayments: [],
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
};

const data: ClientData = {
  client,
  accounts: [hhChecking],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings,
  familyMembers: [],
  entities: [],
  giftEvents: [],
  notesReceivable: [note],
};

describe("netCashFlow includes note-receivable cash", () => {
  it("totalIncome and netCashFlow include the note's totalCashIn", () => {
    const [y0] = runProjection(data);

    const noteCash = y0.notesReceivableTotals!.totalCashIn;
    expect(noteCash).toBeGreaterThan(99_000); // ~$102.7k for a 12-month 5% amortizing note

    // netCashFlow should reconcile: totalIncome − totalExpenses, with note
    // cash counted on the income side.
    expect(y0.netCashFlow).toBeCloseTo(y0.totalIncome - y0.totalExpenses, 0);
    // And totalIncome should itself include the note cash.
    expect(y0.totalIncome).toBeGreaterThanOrEqual(noteCash - 1);
  });
});
