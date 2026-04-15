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
});
