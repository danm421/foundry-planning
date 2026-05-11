import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account } from "../types";

// One taxable brokerage account with a non-zero realization spec, projected
// over a handful of years. Asserts that BoY basis grows year-over-year by
// the prior year's growthDetail.basisIncrease — i.e. recognized growth
// (OI / qdiv / stcg / taxExempt) actually increases cost basis.
//
// Bug being fixed: basisIncrease was written onto growthDetail only; basisMap
// stayed flat, so any future sale double-taxed those dollars as cap gains.

// turnoverPct splits ltcg → stcg internally; the realization type carries
// pctLtCapitalGains only and the engine derives stcg from it.
const taxableWithRealization: Account = {
  id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
  value: 100000, basis: 100000, growthRate: 0.07, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  realization: {
    pctOrdinaryIncome: 0.10,
    pctQualifiedDividends: 0.20,
    pctLtCapitalGains: 0.50,
    pctTaxExempt: 0.05,
    turnoverPct: 0.20,
  },
};

const tradIraWithRealization: Account = {
  id: "acct-ira", name: "Trad IRA", category: "retirement", subType: "traditional_ira",
  value: 100000, basis: 0, growthRate: 0.07, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  realization: {
    pctOrdinaryIncome: 1, pctQualifiedDividends: 0, pctLtCapitalGains: 0,
    pctTaxExempt: 0, turnoverPct: 0,
  },
};

describe("F1: realized growth feeds cost basis", () => {
  it("BoY basis in year N+1 == BoY basis in year N + that year's basisIncrease (taxable)", () => {
    const data = buildClientData({
      accounts: [taxableWithRealization],
      incomes: [], expenses: [], liabilities: [], savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2030 },
    });
    const years = runProjection(data);

    expect(years.length).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < years.length - 1; i++) {
      const yearN = years[i];
      const yearNplus1 = years[i + 1];
      const acctId = "acct-brokerage";

      const basisN = yearN.accountBasisBoY[acctId];
      const basisNplus1 = yearNplus1.accountBasisBoY[acctId];
      const detail = yearN.accountLedgers[acctId].growthDetail;
      expect(detail).toBeDefined();
      const basisIncrease = detail!.basisIncrease;

      expect(basisIncrease).toBeGreaterThan(0); // sanity — realization is firing
      expect(basisNplus1).toBeCloseTo(basisN + basisIncrease, 2); // cent precision

    }
  });

  it("does NOT bump basis for retirement accounts (deferred — basis tracks post-tax contributions)", () => {
    const data = buildClientData({
      accounts: [tradIraWithRealization],
      incomes: [], expenses: [], liabilities: [], savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2030 },
    });
    const years = runProjection(data);
    // Basis must stay flat across all years — realization on a retirement
    // account is descriptive, not basis-bumping. Asserted as a year-over-year
    // delta so the test isn't tied to the fixture's starting basis value.
    for (let i = 0; i < years.length - 1; i++) {
      expect(years[i + 1].accountBasisBoY["acct-ira"]).toBe(years[i].accountBasisBoY["acct-ira"]);
    }
  });

  // Spec 2026-05-11: extends the identity to include withdrawalDetail.basisReturn.
  // basisEoY[n] == basisBoY[n] + basisIncrease[n] − basisReturn[n]
  // basisBoY[n+1] == basisEoY[n]
  it("basis identity includes withdrawalDetail.basisReturn under fresh-basis ordering", () => {
    const checking = {
      id: "chk", name: "Checking", category: "cash" as const, subType: "checking",
      value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const bigExpense = {
      id: "exp", type: "living" as const, name: "Living",
      annualAmount: 80_000, startYear: 2026, endYear: 2030, growthRate: 0,
    };
    const data = buildClientData({
      accounts: [checking, taxableWithRealization],
      incomes: [], expenses: [bigExpense], liabilities: [], savingsRules: [],
      withdrawalStrategy: [
        { accountId: "acct-brokerage", priorityOrder: 1, startYear: 2026, endYear: 2030 },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2030 },
    });
    const years = runProjection(data);

    for (let i = 0; i < years.length; i++) {
      const ledger = years[i].accountLedgers["acct-brokerage"];
      const basisBoY = ledger.basisBoY ?? 0;
      const basisIncrease = ledger.growthDetail?.basisIncrease ?? 0;
      const basisReturn = ledger.withdrawalDetail?.basisReturn ?? 0;
      const basisEoY = ledger.basisEoY ?? 0;
      expect(basisEoY).toBeCloseTo(basisBoY + basisIncrease - basisReturn, 0);
      if (i + 1 < years.length) {
        const nextBoY = years[i + 1].accountLedgers["acct-brokerage"].basisBoY ?? 0;
        expect(nextBoY).toBeCloseTo(basisEoY, 0);
      }
    }
  });
});
