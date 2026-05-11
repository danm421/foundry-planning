import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, WithdrawalPriority } from "../types";

const checking: Account = {
  id: "chk", name: "Checking", category: "cash", subType: "checking",
  value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const taxable60LTCG: Account = {
  id: "tx", name: "Taxable", category: "taxable", subType: "brokerage",
  value: 1_000_000, basis: 700_000, growthRate: 0.06, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  realization: {
    pctOrdinaryIncome: 0.30, pctQualifiedDividends: 0.10,
    pctLtCapitalGains: 0.60, pctTaxExempt: 0, turnoverPct: 0,
  },
};

const taxableAllLTCG: Account = {
  ...taxable60LTCG,
  realization: {
    pctOrdinaryIncome: 0, pctQualifiedDividends: 0,
    pctLtCapitalGains: 1, pctTaxExempt: 0, turnoverPct: 0,
  },
};

const bigExpense = (yearStart: number, yearEnd: number, amount: number): Expense => ({
  id: "exp-big", type: "living", name: "Big Expense",
  annualAmount: amount, startYear: yearStart, endYear: yearEnd, growthRate: 0,
});

const strategyForTx = (yearStart: number, yearEnd: number): WithdrawalPriority[] => [
  { accountId: "tx", priorityOrder: 1, startYear: yearStart, endYear: yearEnd },
];

// Single-client plan (no spouse) so the household tax routing doesn't trip on
// the default married_joint fixture's missing spouse account ownership.
const singleClient = { ...baseClient, filingStatus: "single" as const, spouseName: undefined, spouseDob: undefined, spouseRetirementAge: undefined };

describe("fresh-basis-first withdrawal ordering (spec 2026-05-11)", () => {
  it("single-year reconciliation: basis identity holds and some LTCG is recognized", () => {
    const data = buildClientData({
      client: singleClient,
      accounts: [checking, taxable60LTCG],
      incomes: [], expenses: [bigExpense(2026, 2026, 100_000)],
      liabilities: [], savingsRules: [],
      withdrawalStrategy: strategyForTx(2026, 2026),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection(data);
    const ledger = years[0].accountLedgers["tx"];

    expect(ledger.withdrawalDetail).toBeDefined();
    const wd = ledger.withdrawalDetail!;

    // Identity: basisEoY = basisBoY + basisIncrease − withdrawalDetail.basisReturn
    const basisBoY = ledger.basisBoY ?? 0;
    const basisIncrease = ledger.growthDetail?.basisIncrease ?? 0;
    const basisEoY = ledger.basisEoY ?? 0;
    expect(basisEoY).toBeCloseTo(basisBoY + basisIncrease - wd.basisReturn, 0);

    // Some LTCG should be recognized (draw exceeds fresh basis pool).
    expect(wd.realizedLtcg).toBeGreaterThan(0);
    // ...but less than pure pro-rata would have produced (because fresh pool
    // came out 0%-gain first).
    // Pure pro-rata: 100k × (1 − (700k + basisIncrease) / (1_000_000 + growth))
    // We just sanity-check basisReturn dollars include the fresh chunk.
    expect(wd.basisReturn).toBeGreaterThanOrEqual(basisIncrease);
  });

  it("multi-year aging: Year-2 fresh pool starts at 0 even though Year-1 added basis", () => {
    // Year 1 alone: 60/40 realization → basisIncrease landed in basis.
    const y1Data = buildClientData({
      client: singleClient,
      accounts: [checking, taxable60LTCG],
      incomes: [], expenses: [], liabilities: [], savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const y1Years = runProjection(y1Data);
    const y1BasisEoY = y1Years[0].accountLedgers["tx"].basisEoY ?? 0;
    expect(y1BasisEoY).toBeGreaterThan(700_000); // basisIncrease landed

    // Year 2 standalone, seeded from Year-1 EoY balance + basis. All-LTCG mix
    // ⇒ basisIncrease = 0 ⇒ freshBasisMap empty ⇒ pure pro-rata against legacy.
    const y1BalanceEoY = y1Years[0].accountLedgers["tx"].endingValue;
    const yr2Seeded: Account = { ...taxableAllLTCG, value: y1BalanceEoY, basis: y1BasisEoY };
    const y2Data = buildClientData({
      client: singleClient,
      accounts: [checking, yr2Seeded],
      incomes: [], expenses: [bigExpense(2026, 2026, 100_000)],
      liabilities: [], savingsRules: [],
      withdrawalStrategy: strategyForTx(2026, 2026),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const y2Years = runProjection(y2Data);
    const y2Ledger = y2Years[0].accountLedgers["tx"];
    expect(y2Ledger.growthDetail?.basisIncrease ?? 0).toBe(0);
    expect(y2Ledger.withdrawalDetail!.realizedLtcg).toBeGreaterThan(0);

    // With no fresh pool, the algorithm matches pure pro-rata against the
    // pre-draw legacy basis/value ratio. Tax iteration grosses up the
    // actual draw to cover taxes, so compare the *ratio* recognized to the
    // expected pre-draw ratio (drawn = realizedLtcg + basisReturn).
    const drawn = y2Ledger.withdrawalDetail!.realizedLtcg + y2Ledger.withdrawalDetail!.basisReturn;
    expect(drawn).toBeGreaterThan(100_000);
    const actualRatio = y2Ledger.withdrawalDetail!.realizedLtcg / drawn;
    const preDrawValue = y1BalanceEoY * (1 + 0.06);
    const expectedRatio = 1 - y1BasisEoY / preDrawValue;
    expect(actualRatio).toBeCloseTo(expectedRatio, 3);
  });

  it("basis identity holds year-over-year across a multi-year scenario", () => {
    // 5-year run with the 60% LTCG fixture and a recurring shortfall expense.
    // Walk each consecutive pair and assert:
    //   basisEoY[n] == basisBoY[n] + basisIncrease[n] − basisReturn[n]
    //   basisBoY[n+1] == basisEoY[n]
    const data = buildClientData({
      client: singleClient,
      accounts: [checking, taxable60LTCG],
      incomes: [], expenses: [bigExpense(2026, 2030, 80_000)],
      liabilities: [], savingsRules: [],
      withdrawalStrategy: strategyForTx(2026, 2030),
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2030 },
    });
    const years = runProjection(data);
    expect(years.length).toBe(5);
    for (let i = 0; i < years.length; i++) {
      const yr = years[i];
      const ledger = yr.accountLedgers["tx"];
      const basisBoY = ledger.basisBoY ?? 0;
      const basisIncrease = ledger.growthDetail?.basisIncrease ?? 0;
      const basisReturn = ledger.withdrawalDetail?.basisReturn ?? 0;
      const basisEoY = ledger.basisEoY ?? 0;
      expect(basisEoY).toBeCloseTo(basisBoY + basisIncrease - basisReturn, 0);
      if (i + 1 < years.length) {
        const nextBoY = years[i + 1].accountLedgers["tx"].basisBoY ?? 0;
        expect(nextBoY).toBeCloseTo(basisEoY, 0);
      }
    }
  });
});
