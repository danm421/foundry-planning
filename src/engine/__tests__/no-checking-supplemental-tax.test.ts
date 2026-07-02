import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type {
  Account,
  ClientData,
  Expense,
  FamilyMember,
  RothConversion,
  WithdrawalPriority,
} from "../types";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

// H7/M13/M14 (cash-flow reconciliation audit 2026-07-01): plans WITHOUT a
// default checking account take the legacy funding branch, which drained
// accounts via executeWithdrawals without recognizing draw income, without
// recomputing tax, and without the 10% pre-59½ penalty. A $100k IRA shortfall
// withdrawal produced $0 incremental tax. These are the no-checking twins of
// early-withdrawal-supplemental.test.ts — same economics, no checking account.

function buildSinglePersonClient(birthYear: number): FamilyMember[] {
  return [{
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Solo",
    lastName: "Test",
    dateOfBirth: `${birthYear}-01-01`,
  }];
}

function tradIra(value: number): Account {
  return {
    id: "acct-ira", name: "Trad IRA", category: "retirement", subType: "traditional_ira",
    titlingType: "jtwros",
    value, basis: 0, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };
}

const livingExpense: Expense = {
  id: "exp-living", name: "Living", type: "living",
  annualAmount: 80000, growthRate: 0, startYear: 2026, endYear: 2026,
};

function strategy(accountId: string): WithdrawalPriority[] {
  return [{ accountId, priorityOrder: 1, startYear: 2026, endYear: 2026 }];
}

function noCheckingData(birthYear: number, iraValue = 500000): ReturnType<typeof buildClientData> {
  return buildClientData({
    client: { ...baseClient, dateOfBirth: `${birthYear}-01-01`, spouseDob: undefined },
    familyMembers: buildSinglePersonClient(birthYear),
    accounts: [tradIra(iraValue)], // NO default checking → legacy branch
    incomes: [], expenses: [livingExpense], liabilities: [], savingsRules: [],
    withdrawalStrategy: strategy("acct-ira"),
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
  });
}

describe("H7: no-checking shortfall draws recognize income and charge tax", () => {
  it("charges income tax on a post-59.5 Trad-IRA shortfall draw", () => {
    const years = runProjection(noCheckingData(1960)); // age 66 in 2026
    const year = years[0];

    const iraDraw = year.withdrawals.byAccount["acct-ira"] ?? 0;
    expect(iraDraw).toBeGreaterThan(0);

    // basePlanSettings: 22% federal + 5% state = 27% flat marginal. The draw
    // is 100% ordinary income, so the year's taxes must be ≈ 27% of the draw
    // (RED today: $0 — the legacy branch never recomputes tax).
    expect(year.expenses.taxes).toBeGreaterThanOrEqual(iraDraw * 0.26);

    // Cash-vs-P&L: the draw funds the living expense PLUS the tax it created,
    // i.e. the withdrawal is grossed up (D = 80k + 0.27·D → D ≈ $109,589).
    expect(
      Math.abs(year.withdrawals.total - (80000 + year.expenses.taxes)),
    ).toBeLessThanOrEqual(5);
  });

  it("levies the 10% early-withdrawal penalty on a pre-59.5 draw", () => {
    const years = runProjection(noCheckingData(1971)); // age 55 in 2026
    const year = years[0];

    const iraDraw = year.withdrawals.byAccount["acct-ira"] ?? 0;
    expect(iraDraw).toBeGreaterThan(0);

    // 27% marginal + 10% penalty = 37% floor on the grossed-up draw.
    expect(year.expenses.taxes).toBeGreaterThanOrEqual(iraDraw * 0.36);

    // Penalty surfaces in the drill-down and the converged tax flow.
    const penalty = year.expenses.bySource["withdrawal_penalty:acct-ira"] ?? 0;
    expect(penalty).toBeCloseTo(iraDraw * 0.1, 0);
    expect(year.taxResult?.flow.earlyWithdrawalPenalty ?? 0).toBeGreaterThan(0);
  });
});

describe("M14: depleted no-checking plan goes visibly negative", () => {
  it("posts the unfunded shortfall as a negative balance so MC can classify failure", () => {
    // Pool ($50k IRA) can't cover the $80k expense + tax on the draw. The
    // unfunded remainder must drive the drawn account negative — mirroring a
    // hasChecking plan whose checking goes negative when broke. RED today:
    // executeWithdrawals clamps at $0, the plan reads as fully funded, and
    // Monte-Carlo's liquids-<0 failure check can never fire.
    const years = runProjection(noCheckingData(1960, 50000)); // age 66
    const year = years[0];

    expect(year.withdrawals.byAccount["acct-ira"] ?? 0).toBeGreaterThanOrEqual(50000);
    expect(year.portfolioAssets.retirementTotal).toBeLessThan(0);
  });
});

describe("M13: no-checking fill_up_bracket conversion tax is funded by a draw", () => {
  const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
  const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";

  function fillBracketNoCheckingScenario(): ClientData {
    const conversion: RothConversion = {
      id: "rc-fill",
      name: "Fill 22%",
      destinationAccountId: "acc-roth",
      sourceAccountIds: ["acc-ira"],
      conversionType: "fill_up_bracket",
      fillUpBracket: 0.22,
      fixedAmount: 0,
      startYear: 2026,
      indexingRate: 0,
    };

    return {
      client: {
        firstName: "Cooper",
        lastName: "Test",
        dateOfBirth: "1970-01-01", // age 56 in 2026
        spouseDob: "1975-01-01",
        filingStatus: "married_joint",
        retirementAge: 65,
        planEndAge: 90,
        spouseRetirementAge: 65,
      },
      accounts: [
        {
          id: "acc-brokerage",
          name: "Joint Brokerage",
          category: "taxable",
          subType: "brokerage",
          titlingType: "jtwros",
          value: 500_000,
          basis: 500_000, // basis == value → draws create no additional gain
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
            { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
          ],
        },
        {
          id: "acc-ira",
          name: "Cooper Trad IRA",
          category: "retirement",
          subType: "traditional_ira",
          titlingType: "jtwros",
          value: 3_000_000,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
        },
        {
          id: "acc-roth",
          name: "Cooper Roth IRA",
          category: "retirement",
          subType: "roth_ira",
          titlingType: "jtwros",
          value: 0,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
        },
      ],
      incomes: [
        {
          id: "inc-salary",
          name: "Cooper salary",
          type: "salary",
          owner: "client",
          annualAmount: 80_000,
          growthRate: 0,
          startYear: 2026,
          endYear: 2026,
        },
      ],
      expenses: [
        {
          id: "exp-living",
          name: "Living",
          type: "living",
          annualAmount: 70_000,
          growthRate: 0,
          startYear: 2026,
          endYear: 2026,
        },
      ],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [
        { accountId: "acc-brokerage", priorityOrder: 1, startYear: 2026, endYear: 2026 },
      ],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2026,
        taxEngineMode: "bracket",
        taxInflationRate: 0.025,
        estateAdminExpenses: 0,
        flatStateEstateRate: 0,
      },
      entities: [],
      deductions: [],
      transfers: [],
      assetTransactions: [],
      gifts: [],
      giftEvents: [],
      wills: [],
      rothConversions: [conversion],
      familyMembers: [
        {
          id: CLIENT_FM_ID,
          firstName: "Cooper",
          lastName: "Test",
          relationship: "other",
          role: "client",
          dateOfBirth: "1970-01-01",
        } as FamilyMember,
        {
          id: SPOUSE_FM_ID,
          firstName: "Partner",
          lastName: "Test",
          relationship: "other",
          role: "spouse",
          dateOfBirth: "1975-01-01",
        } as FamilyMember,
      ],
      externalBeneficiaries: [],
      taxYearRows: [TAX_YEAR_2026],
    } as ClientData;
  }

  it("draws enough to cover the conversion tax delta (cash-vs-P&L holds)", () => {
    const years = runProjection(fillBracketNoCheckingScenario());
    const year = years[0];

    // The conversion actually fired and is taxable.
    const conv = (year.rothConversions ?? [])[0];
    expect(conv).toBeDefined();
    expect(conv!.taxable).toBeGreaterThan(0);

    // Conservation: inflows (salary) + draws must cover living + taxes.
    // expenses.taxes includes the fill-bracket conversion tax, so without a
    // compensating draw the reported tax outflow never moves a balance
    // (RED today: draws cover only living + PRE-conversion tax).
    const residual =
      year.withdrawals.total - (70_000 + year.expenses.taxes - 80_000);
    expect(Math.abs(residual)).toBeLessThanOrEqual(5);
    expect(year.withdrawals.total).toBeGreaterThan(15_000);
  });
});
