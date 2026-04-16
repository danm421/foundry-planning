import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";

describe("runProjection", () => {
  it("returns one ProjectionYear per year in the plan range", () => {
    const data = buildClientData();
    const result = runProjection(data);
    const expectedYears = data.planSettings.planEndYear - data.planSettings.planStartYear + 1;
    expect(result).toHaveLength(expectedYears);
    expect(result[0].year).toBe(2026);
    expect(result[result.length - 1].year).toBe(2055);
  });

  it("computes correct ages from DOB", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // John born 1970, year 2026 → age 56
    expect(result[0].ages.client).toBe(56);
    // Jane born 1972, year 2026 → age 54 (using birth year from "1972-06-15")
    expect(result[0].ages.spouse).toBe(54);
  });

  it("computes income totals in year 1", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // John salary 150k + Jane salary 100k = 250k (SS not started yet)
    expect(result[0].income.salaries).toBe(250000);
    expect(result[0].income.socialSecurity).toBe(0);
    expect(result[0].income.total).toBe(250000);
  });

  it("includes liability payments in expenses", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // Mortgage: $2500/mo = $30000/yr
    expect(result[0].expenses.liabilities).toBe(30000);
  });

  it("computes taxes on taxable income", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // Taxable income = salaries = 250000, rate = 27%
    expect(result[0].expenses.taxes).toBeGreaterThan(0);
  });

  it("applies savings rules when there is a surplus", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // With 250k income and ~115k expenses+taxes, there should be a surplus
    expect(result[0].savings.total).toBeGreaterThan(0);
    expect(result[0].savings.byAccount["acct-401k"]).toBe(23500);
  });

  it("grows account balances year over year", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // 401k starts at 500k, grows at 7%, plus contributions
    const yr1_401k = result[0].portfolioAssets.retirement["acct-401k"];
    expect(yr1_401k).toBeGreaterThan(500000);
  });

  it("produces account ledgers for each account each year", () => {
    const data = buildClientData();
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-401k"];
    expect(ledger).toBeDefined();
    expect(ledger.beginningValue).toBe(500000);
    expect(ledger.growth).toBeCloseTo(500000 * 0.07, 0);
    expect(ledger.endingValue).toBeGreaterThan(500000);
  });

  it("handles empty plan with no income, expenses, or accounts", () => {
    const data = buildClientData({
      accounts: [],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2028 },
    });
    const result = runProjection(data);
    expect(result).toHaveLength(3);
    expect(result[0].netCashFlow).toBe(0);
    expect(result[0].portfolioAssets.total).toBe(0);
  });

  it("triggers withdrawals when expenses exceed income in retirement", () => {
    const data = buildClientData({
      incomes: [], // No income — pure retirement
      planSettings: { ...basePlanSettings, planStartYear: 2040, planEndYear: 2042 },
    });
    const result = runProjection(data);
    // With expenses but no income, should trigger withdrawals
    if (result[0].expenses.total > 0) {
      expect(result[0].withdrawals.total).toBeGreaterThan(0);
    }
  });

  it("applies RMDs to eligible accounts when owner reaches RMD age", () => {
    // John born 1970, RMD starts at 75 (year 2045)
    const data = buildClientData({
      accounts: [
        {
          id: "acct-trad-ira",
          name: "Traditional IRA",
          category: "retirement",
          subType: "traditional_ira",
          owner: "client",
          value: 1000000,
          basis: 1000000,
          growthRate: 0.07,
          rmdEnabled: true,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2044, planEndYear: 2047 },
    });
    const result = runProjection(data);

    // Year 2044: age 74, no RMD yet
    const yr2044 = result[0];
    expect(yr2044.ages.client).toBe(74);
    expect(yr2044.accountLedgers["acct-trad-ira"].rmdAmount).toBe(0);

    // Year 2045: age 75, RMD kicks in
    const yr2045 = result[1];
    expect(yr2045.ages.client).toBe(75);
    expect(yr2045.accountLedgers["acct-trad-ira"].rmdAmount).toBeGreaterThan(0);
    // RMD should be balance / 24.6 (divisor for age 75)
    expect(yr2045.accountLedgers["acct-trad-ira"].rmdAmount).toBeGreaterThan(30000);
  });

  it("does not apply RMDs to Roth accounts", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-roth",
          name: "Roth IRA",
          category: "retirement",
          subType: "roth_ira",
          owner: "client",
          value: 1000000,
          basis: 500000,
          growthRate: 0.07,
          rmdEnabled: false,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2045, planEndYear: 2047 },
    });
    const result = runProjection(data);

    // Age 75, but Roth is not RMD-eligible
    for (const yr of result) {
      expect(yr.accountLedgers["acct-roth"].rmdAmount).toBe(0);
    }
  });

  it("RMD distributions reduce account balance", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-401k-rmd",
          name: "401k RMD Test",
          category: "retirement",
          subType: "401k",
          owner: "client",
          value: 500000,
          basis: 500000,
          growthRate: 0.0, // No growth to simplify
          rmdEnabled: true,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2045, planEndYear: 2046 },
    });
    const result = runProjection(data);

    // Year 2045: age 75, 0% growth, RMD = 500000 / 24.6
    const yr = result[0];
    const expectedRmd = 500000 / 24.6;
    expect(yr.accountLedgers["acct-401k-rmd"].rmdAmount).toBeCloseTo(expectedRmd, 0);
    expect(yr.accountLedgers["acct-401k-rmd"].endingValue).toBeCloseTo(500000 - expectedRmd, 0);
  });

  it("splits growth by realization model when account has realization data", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          owner: "client",
          value: 100000,
          basis: 80000,
          growthRate: 0.10,
          rmdEnabled: false,
          realization: {
            pctOrdinaryIncome: 0.10,
            pctLtCapitalGains: 0.70,
            pctQualifiedDividends: 0.15,
            pctTaxExempt: 0.05,
            turnoverPct: 0.10,
          },
        },
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          owner: "client",
          value: 50000,
          basis: 50000,
          growthRate: 0.02,
          rmdEnabled: false,
          isDefaultChecking: true,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-brokerage"];
    expect(ledger.growth).toBeCloseTo(10000, 0);
    expect(ledger.growthDetail).toBeDefined();
    // OI: 10000 * 0.10 = 1000
    expect(ledger.growthDetail!.ordinaryIncome).toBeCloseTo(1000, 0);
    // QDiv: 10000 * 0.15 = 1500
    expect(ledger.growthDetail!.qualifiedDividends).toBeCloseTo(1500, 0);
    // LTCG before turnover: 10000 * 0.70 = 7000
    // STCG: 7000 * 0.10 = 700
    expect(ledger.growthDetail!.stCapitalGains).toBeCloseTo(700, 0);
    // LTCG after turnover: 7000 * 0.90 = 6300
    expect(ledger.growthDetail!.ltCapitalGains).toBeCloseTo(6300, 0);
    // TaxExempt: 10000 * 0.05 = 500
    expect(ledger.growthDetail!.taxExempt).toBeCloseTo(500, 0);
    // Basis increase: OI + QDiv + STCG + TaxExempt = 1000 + 1500 + 700 + 500 = 3700
    expect(ledger.growthDetail!.basisIncrease).toBeCloseTo(3700, 0);
  });

  it("does not add realization detail for accounts without realization data", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-house",
          name: "Primary Home",
          category: "real_estate",
          subType: "primary_residence",
          owner: "joint",
          value: 500000,
          basis: 400000,
          growthRate: 0.04,
          rmdEnabled: false,
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-house"];
    expect(ledger.growthDetail).toBeUndefined();
  });

  it("includes realization income in taxDetail breakdown", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          owner: "client",
          value: 100000,
          basis: 80000,
          growthRate: 0.10,
          rmdEnabled: false,
          realization: {
            pctOrdinaryIncome: 0.10,
            pctLtCapitalGains: 0.70,
            pctQualifiedDividends: 0.15,
            pctTaxExempt: 0.05,
            turnoverPct: 0.10,
          },
        },
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          owner: "client",
          value: 50000,
          basis: 50000,
          growthRate: 0.02,
          rmdEnabled: false,
          isDefaultChecking: true,
        },
      ],
      incomes: [
        {
          id: "inc-salary",
          type: "salary",
          name: "Salary",
          annualAmount: 100000,
          startYear: 2026,
          endYear: 2026,
          growthRate: 0,
          owner: "client",
          taxType: "earned_income" as const,
        },
      ],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    expect(result[0].taxDetail).toBeDefined();
    expect(result[0].taxDetail!.earnedIncome).toBe(100000);
    expect(result[0].taxDetail!.ordinaryIncome).toBeCloseTo(1000, 0);
    expect(result[0].taxDetail!.dividends).toBeCloseTo(1500, 0);
    expect(result[0].taxDetail!.stCapitalGains).toBeCloseTo(700, 0);
  });
});
