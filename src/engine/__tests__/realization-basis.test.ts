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

const taxableWithRealization: Account = {
  id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
  value: 100000, basis: 100000, growthRate: 0.07, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  realization: {
    pctOrdinaryIncome: 0.10,
    pctQualifiedDividends: 0.20,
    pctLtCapitalGains: 0.50,
    pctStCapitalGains: 0,        // turnoverPct splits ltcg → stcg internally
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
    pctStCapitalGains: 0, pctTaxExempt: 0, turnoverPct: 0,
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
      expect(basisNplus1).toBeCloseTo(basisN + basisIncrease, 6);
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
    for (const year of years) {
      expect(year.accountBasisBoY["acct-ira"]).toBe(0);
    }
  });
});
