import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, FamilyMember, Transfer } from "../types";

// R3 (transfer drill-down books GROSS as ordinary income). The engine records
// each transfer into taxDetail.bySource under `transfer:<id>` as
// `{ type: "ordinary_income", amount: byTransfer.amount }` — but byTransfer.amount
// is the GROSS transfer (transfers.ts), while taxDetail.ordinaryIncome only gains
// the TAXABLE portion (classifyTransferTax). For a post-59.5 (qualified) Roth
// in-kind transfer the taxable portion is $0, so the ledger shows a phantom
// taxable Transfer row that reconciliation then offsets with a spurious −$X
// Unattributed row (household flagged unreconciled), even though the income report
// correctly shows $0. A transfer is an internal asset move, not a cash-flow income
// event, and never feeds taxFreeRetirementIncome/grossTotalIncome — so the fix is
// to book the TAXABLE ordinary income (not the gross), with no tax-free row.

const BIRTH_YEAR = 1964; // age 62 in 2026 → post-59.5, qualified

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
  value: 50_000, basis: 50_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const brokerage: Account = {
  id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
  titlingType: "jtwros",
  value: 10_000, basis: 10_000, growthRate: 0, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

function runYearOne(source: Account, transfer: Transfer) {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: `${BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, brokerage, source],
    incomes: [], expenses: [], liabilities: [], savingsRules: [],
    withdrawalStrategy: [],
    transfers: [transfer],
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027 },
  });
  return runProjection(data)[0];
}

describe("transfer drill-down bySource (R3: book taxable, not gross)", () => {
  it("books no taxable row for a qualified (post-59.5) Roth in-kind transfer", () => {
    const roth: Account = {
      id: "acct-roth", name: "Roth IRA", category: "retirement", subType: "roth_ira",
      titlingType: "jtwros",
      value: 100_000, basis: 60_000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const year = runYearOne(roth, {
      id: "xfer-roth", name: "Roth to Brokerage", sourceAccountId: "acct-roth",
      targetAccountId: "acct-brokerage", amount: 50_000, mode: "one_time",
      startYear: 2026, growthRate: 0, schedules: [],
    });

    // Qualified Roth distribution → $0 taxable → NO phantom taxable Transfer row.
    expect(year.taxDetail!.bySource["transfer:xfer-roth"]).toBeUndefined();
    // And it must not fabricate a tax-free income row (transfers aren't income).
    expect(year.taxDetail!.bySource["transfer_tax_free:xfer-roth"]).toBeUndefined();
    // The transfer contributes nothing to ordinary income.
    expect(year.taxDetail!.ordinaryIncome).toBe(0);
  });

  it("books the TAXABLE ordinary slice (not the gross) for a mixed 401(k) transfer", () => {
    // 401(k) with a 40% Roth slice: a $50k transfer is 60% pre-tax = $30k taxable OI.
    const mixed401k: Account = {
      id: "acct-401k", name: "Mixed 401(k)", category: "retirement", subType: "401k",
      titlingType: "jtwros",
      value: 100_000, basis: 0, rothValue: 40_000, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const year = runYearOne(mixed401k, {
      id: "xfer-401k", name: "401k to Brokerage", sourceAccountId: "acct-401k",
      targetAccountId: "acct-brokerage", amount: 50_000, mode: "one_time",
      startYear: 2026, growthRate: 0, schedules: [],
    });

    // Books the taxable $30k, NOT the $50k gross — and no tax-free row for the $20k.
    expect(year.taxDetail!.bySource["transfer:xfer-401k"]).toEqual({
      type: "ordinary_income",
      amount: 30_000,
    });
    expect(year.taxDetail!.bySource["transfer_tax_free:xfer-401k"]).toBeUndefined();
    expect(year.taxDetail!.ordinaryIncome).toBeCloseTo(30_000, 6);
  });
});
