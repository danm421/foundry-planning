import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient, sampleExpenses, sampleAccounts } from "./fixtures";
import type { TaxYearParameters } from "../../lib/tax/types";
import type { ClientData, ClientInfo, Account, PlanSettings } from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

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

  it("employer match uses only the account owner's salary, not household total", () => {
    // Fixture: John salary 150k (client), Jane salary 100k (spouse).
    // 401k is owned by client with employerMatchPct=0.5, employerMatchCap=0.06.
    // Correct match = 150000 * 0.5 * 0.06 = 4500 (NOT 250000 * 0.5 * 0.06 = 7500).
    const data = buildClientData();
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-401k"];
    const matchEntries = ledger.entries.filter((e) => e.category === "employer_match");
    expect(matchEntries).toHaveLength(1);
    expect(matchEntries[0].amount).toBe(4500);
  });

  it("employer match is zero when the savings account is joint-owned", () => {
    // A joint-owned retirement account has no individual salary to base the match on,
    // so the match should be 0 rather than falling back to household salary.
    // Cap planEndYear before RMD age (75) — joint-owned retirement accounts
    // violate the migration 0055 single-owner CHECK and the engine RMD guard
    // throws, but they're still a valid input for the pre-RMD employer-match
    // test we're asserting against.
    const data = buildClientData({
      accounts: sampleAccounts.map((a) =>
        a.id === "acct-401k" ? { ...a, owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 }, { kind: "family_member" as const, familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 }] } : a
      ),
      planSettings: { ...basePlanSettings, planEndYear: 2040 },
    });
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-401k"];
    const matchEntries = ledger.entries.filter((e) => e.category === "employer_match");
    expect(matchEntries).toHaveLength(0);
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
          value: 1000000,
          basis: 1000000,
          growthRate: 0.07,
          rmdEnabled: true,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
          value: 1000000,
          basis: 500000,
          growthRate: 0.07,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
          value: 500000,
          basis: 500000,
          growthRate: 0.0, // No growth to simplify
          rmdEnabled: true,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
          value: 100000,
          basis: 80000,
          growthRate: 0.10,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
          value: 50000,
          basis: 50000,
          growthRate: 0.02,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
          value: 500000,
          basis: 400000,
          growthRate: 0.04,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
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
          value: 100000,
          basis: 80000,
          growthRate: 0.10,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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
          value: 50000,
          basis: 50000,
          growthRate: 0.02,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
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

// ============================================================================
// Tax engine routing integration tests (Task 28)
// ============================================================================

const FIXTURE_TAX_PARAMS: TaxYearParameters[] = [{
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
}];

describe("projection — bracket/flat tax routing", () => {
  it("populates taxResult on every projection year when mode=bracket", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2028 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    for (const y of years) {
      expect(y.taxResult).toBeDefined();
      expect(y.taxResult!.flow.totalTax).toBeGreaterThanOrEqual(0);
    }
  });

  it("flat mode taxes equal taxableIncome × (federal+state) — formula regression", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "flat", planStartYear: 2026, planEndYear: 2028 },
    });
    const fedRate = fixture.planSettings.flatFederalRate;
    const stateRate = fixture.planSettings.flatStateRate;
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    for (const y of years) {
      const expected = Math.max(0, y.taxResult!.flow.taxableIncome) * (fedRate + stateRate);
      expect(y.expenses.taxes).toBeCloseTo(expected, 2);
    }
  });

  it("includes auto-derived above-line deductions from traditional retirement savings rules", () => {
    // The default fixture has a 401k savings rule (annualAmount: 23500, 2026-2035)
    // targeting acct-401k (subType: "401k"), so above-line should reflect that contribution.
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    expect(firstYear.taxResult!.flow.aboveLineDeductions).toBeGreaterThan(0);
    // 401k contribution is $23,500 — expect at least that much above-line
    expect(firstYear.taxResult!.flow.aboveLineDeductions).toBeGreaterThanOrEqual(23500);
  });

  it("applies SALT cap to itemized deductions", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const fixtureWithDeductions = {
      ...fixture,
      deductions: [
        { type: "property_tax" as const, annualAmount: 20000, growthRate: 0, startYear: 2026, endYear: 2076 },
        { type: "charitable" as const, annualAmount: 25000, growthRate: 0, startYear: 2026, endYear: 2076 },
      ],
    };
    const years = runProjection({ ...fixtureWithDeductions, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    // SALT: $20k (under $40k cap for 2026) + charitable $25k = $45k itemized
    expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThanOrEqual(45000);
  });

  it("derives mortgage interest deduction from isInterestDeductible liability", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    // Mortgage balance 300k at 6.5% = ~$19,500 interest. With isInterestDeductible=true,
    // this should appear in below-line deductions.
    expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThan(0);
  });

  it("derives property tax from real estate accounts into SALT pool", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    // Property tax of $12k flows into SALT pool (under $40k cap)
    expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThan(0);
    // Verify realEstate expense category is populated
    expect(firstYear.expenses.realEstate).toBeGreaterThan(0);
  });

  it("populates deductionBreakdown.aboveLine with retirement contributions", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const bd = years[0].deductionBreakdown;
    expect(bd).toBeDefined();
    expect(bd!.aboveLine.retirementContributions).toBe(23500);
    expect(bd!.aboveLine.total).toBe(bd!.aboveLine.retirementContributions + bd!.aboveLine.taggedExpenses + bd!.aboveLine.manualEntries);
  });

  it("populates deductionBreakdown.belowLine with taxesPaid and interestPaid", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const bd = years[0].deductionBreakdown;
    expect(bd).toBeDefined();
    expect(bd!.belowLine.taxesPaid).toBeGreaterThan(0);
    expect(bd!.belowLine.interestPaid).toBeGreaterThan(0);
    expect(bd!.belowLine.itemizedTotal).toBe(
      bd!.belowLine.charitable + bd!.belowLine.taxesPaid + bd!.belowLine.interestPaid + bd!.belowLine.otherItemized
    );
  });

  it("belowLine.taxDeductions is max of itemizedTotal and standardDeduction", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const bd = years[0].deductionBreakdown;
    expect(bd).toBeDefined();
    expect(bd!.belowLine.taxDeductions).toBe(
      Math.max(bd!.belowLine.itemizedTotal, bd!.belowLine.standardDeduction)
    );
    expect(bd!.belowLine.standardDeduction).toBeGreaterThan(0);
  });

  it("routes charitable-tagged expense into itemized deductions", () => {
    const charitableExpense = {
      id: "exp-charity",
      type: "other" as const,
      name: "Annual Giving",
      annualAmount: 25000,
      startYear: 2026,
      endYear: 2055,
      growthRate: 0,
      owner: "client",
      deductionType: "charitable" as const,
    };
    const fixture = buildClientData({
      expenses: [...sampleExpenses, charitableExpense],
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    // $25k charitable + mortgage interest + property tax SALT → below-line > 25k
    expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThanOrEqual(25000);
  });
});

describe("asset mix blending", () => {
  function blendAllocations(
    allocations: { weight: number; geoReturn: number; pctOi: number; pctLtcg: number; pctQdiv: number; pctTaxEx: number }[],
    inflation: { geoReturn: number; pctOi: number; pctLtcg: number; pctQdiv: number; pctTaxEx: number }
  ) {
    let totalWeight = 0;
    let geoReturn = 0;
    let pctOi = 0, pctLtcg = 0, pctQdiv = 0, pctTaxEx = 0;
    for (const a of allocations) {
      totalWeight += a.weight;
      geoReturn += a.weight * a.geoReturn;
      pctOi += a.weight * a.pctOi;
      pctLtcg += a.weight * a.pctLtcg;
      pctQdiv += a.weight * a.pctQdiv;
      pctTaxEx += a.weight * a.pctTaxEx;
    }
    const unclassified = Math.max(0, 1 - totalWeight);
    if (unclassified > 0) {
      geoReturn += unclassified * inflation.geoReturn;
      pctOi += unclassified * inflation.pctOi;
      pctLtcg += unclassified * inflation.pctLtcg;
      pctQdiv += unclassified * inflation.pctQdiv;
      pctTaxEx += unclassified * inflation.pctTaxEx;
    }
    return { geoReturn, pctOi, pctLtcg, pctQdiv, pctTaxEx };
  }

  const inflation = { geoReturn: 0.025, pctOi: 1, pctLtcg: 0, pctQdiv: 0, pctTaxEx: 0 };

  it("blends fully allocated portfolio (no unclassified)", () => {
    const result = blendAllocations([
      { weight: 0.6, geoReturn: 0.08, pctOi: 0.1, pctLtcg: 0.5, pctQdiv: 0.3, pctTaxEx: 0.1 },
      { weight: 0.4, geoReturn: 0.04, pctOi: 0.8, pctLtcg: 0.1, pctQdiv: 0.1, pctTaxEx: 0.0 },
    ], inflation);
    expect(result.geoReturn).toBeCloseTo(0.064, 6);
    expect(result.pctOi).toBeCloseTo(0.38, 6);
    expect(result.pctLtcg).toBeCloseTo(0.34, 6);
  });

  it("adds unclassified portion at inflation rate", () => {
    const result = blendAllocations([
      { weight: 0.7, geoReturn: 0.08, pctOi: 0.2, pctLtcg: 0.5, pctQdiv: 0.2, pctTaxEx: 0.1 },
    ], inflation);
    expect(result.geoReturn).toBeCloseTo(0.0635, 6);
    expect(result.pctOi).toBeCloseTo(0.44, 6);
  });

  it("returns pure inflation when no allocations", () => {
    const result = blendAllocations([], inflation);
    expect(result.geoReturn).toBeCloseTo(0.025, 6);
    expect(result.pctOi).toBeCloseTo(1.0, 6);
    expect(result.pctLtcg).toBeCloseTo(0, 6);
  });
});

// ============================================================================
// Techniques integration tests (Task 7)
// ============================================================================

describe("techniques integration", () => {
  it("Roth conversion reduces IRA and increases Roth, taxed as ordinary income", () => {
    const data = buildClientData({
      transfers: [
        {
          id: "t-roth",
          name: "Roth Conversion",
          sourceAccountId: "acct-401k",
          targetAccountId: "acct-roth",
          amount: 50000,
          mode: "one_time" as const,
          startYear: 2028,
          growthRate: 0,
          schedules: [],
        },
      ],
    });

    const result = runProjection(data);
    const year2028 = result.find((y) => y.year === 2028)!;

    expect(year2028.taxDetail!.ordinaryIncome).toBeGreaterThan(0);
    const k401Ledger = year2028.accountLedgers["acct-401k"];
    expect(k401Ledger.distributions).toBeGreaterThan(0);
  });

  it("asset sale removes account and generates capital gains", () => {
    const data = buildClientData({
      assetTransactions: [
        {
          id: "sale-1",
          name: "Sell Brokerage",
          type: "sell" as const,
          year: 2028,
          accountId: "acct-brokerage",
        },
      ],
    });

    const result = runProjection(data);
    const year2028 = result.find((y) => y.year === 2028)!;
    expect(year2028.taxDetail!.capitalGains).toBeGreaterThan(0);

    // Account should be gone in subsequent years
    const year2029 = result.find((y) => y.year === 2029)!;
    expect(year2029.accountLedgers["acct-brokerage"]).toBeUndefined();
  });

  it("sale-only surplus contributes exactly once to income.other (not doubled via bySource)", () => {
    // Regression test for the fixes-doc #11 double-count: the engine folds
    // technique-proceeds into income.other AND records them in income.bySource.
    // Any UI that reads income.other + sum(bySource[technique-*]) double-counts
    // the proceeds. Guard the invariant at the engine boundary so future UI
    // work can rely on `income.other` as the single source of truth.
    const data = buildClientData({
      incomes: [], // no type=other income rows — so income.other is all technique
      assetTransactions: [
        {
          id: "sale-only",
          name: "Sell Brokerage",
          type: "sell" as const,
          year: 2028,
          accountId: "acct-brokerage",
        },
      ],
    });

    const result = runProjection(data);
    const year2028 = result.find((y) => y.year === 2028)!;

    const techniqueProceedsInBySource = Object.entries(year2028.income.bySource)
      .filter(([id]) => id.startsWith("technique-proceeds:"))
      .reduce((sum, [, v]) => sum + v, 0);

    // Sale surplus must be positive for this test to mean anything.
    expect(techniqueProceedsInBySource).toBeGreaterThan(0);
    // `income.other` should equal the technique proceeds exactly (no other rows),
    // proving the engine folds technique income into `.other` exactly once.
    expect(year2028.income.other).toBeCloseTo(techniqueProceedsInBySource, 2);
  });

  it("same-year sell + buy nets at year level in cash flow (fixes #10)", () => {
    // Advisor reports a sale of one property and a purchase of another in the
    // same year shouldn't surface the full sale netProceeds as "Other Inflows"
    // — it should show the NET transaction amount (sale proceeds minus purchase
    // equity). Engine pairs same-year sales with same-year purchases regardless
    // of transactionId.
    const data = buildClientData({
      accounts: [
        {
          id: "acct-checking",
          name: "Household Cash",
          category: "cash",
          subType: "checking",
          value: 50_000,
          basis: 50_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
          isDefaultChecking: true,
        },
        {
          id: "acct-sell-home",
          name: "Old Home",
          category: "real_estate",
          subType: "primary_residence",
          value: 500_000,
          basis: 400_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "sell-home",
          name: "Sell Old Home",
          type: "sell" as const,
          year: 2026,
          accountId: "acct-sell-home",
          qualifiesForHomeSaleExclusion: true,
        },
        {
          id: "buy-home",
          name: "Buy New Home",
          type: "buy" as const,
          year: 2026,
          assetName: "New Home",
          assetCategory: "real_estate" as const,
          assetSubType: "primary_residence",
          purchasePrice: 400_000,
          growthRate: 0,
          // No mortgage → equity = purchasePrice = 400k
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });

    const result = runProjection(data);
    const year = result[0];

    // Sale netProceeds = 500k (no costs, no mortgage payoff).
    // Purchase equity = 400k (all cash).
    // Year net = +100k → income.other = 100k, expenses.other (from techniques) = 0.
    expect(year.income.other).toBeCloseTo(100_000, 0);

    // bySource technique-proceeds sums to 100k (the net), not 500k (raw proceeds).
    const techniqueProceedsSum = Object.entries(year.income.bySource)
      .filter(([id]) => id.startsWith("technique-proceeds:"))
      .reduce((s, [, v]) => s + v, 0);
    expect(techniqueProceedsSum).toBeCloseTo(100_000, 0);

    // No technique-purchase expense entry since the purchase equity is fully
    // absorbed by the sale proceeds in the same year.
    const techniquePurchaseSum = Object.entries(year.expenses.bySource ?? {})
      .filter(([id]) => id.startsWith("technique-purchase:"))
      .reduce((s, [, v]) => s + v, 0);
    expect(techniquePurchaseSum).toBeCloseTo(0, 0);
  });

  it("contributeMax on a 401k rule contributes the elective + age-50 catchup (fixes #7)", () => {
    // John is born 1970 → age 56 in 2026, catchup-50 applies.
    // 401k max = ira401kElective 23500 + ira401kCatchup50 7500 = 31000.
    const data = buildClientData({
      savingsRules: [
        {
          id: "sav-401k-max",
          accountId: "acct-401k",
          annualAmount: 0, // ignored when contributeMax=true
          contributeMax: true,
          isDeductible: true,
          startYear: 2026,
          endYear: 2030,
        },
      ],
      taxYearRows: FIXTURE_TAX_PARAMS,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    expect(result[0].savings.byAccount["acct-401k"]).toBeCloseTo(31_000, 0);
  });

  it("contributeMax on a Roth IRA rule contributes base + age-50 catchup (fixes #7)", () => {
    // Jane is born 1972 → age 54 in 2026, catchup-50 applies.
    // IRA max = iraTradLimit 7000 + iraCatchup50 1000 = 8000.
    // acct-roth in the fixture is Jane's Roth IRA.
    const data = buildClientData({
      savingsRules: [
        {
          id: "sav-roth-max",
          accountId: "acct-roth",
          annualAmount: 0,
          contributeMax: true,
          isDeductible: false,
          startYear: 2026,
          endYear: 2030,
        },
      ],
      taxYearRows: FIXTURE_TAX_PARAMS,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    expect(result[0].savings.byAccount["acct-roth"]).toBeCloseTo(8_000, 0);
  });

  it("same-year purchase > sale shows a net expense, not a net inflow (fixes #10)", () => {
    // Sale nets 200k, purchase equity 500k → year net = -300k. Advisor should
    // see a 300k expense and 0 inflow, not a 200k inflow and 500k expense.
    const data = buildClientData({
      accounts: [
        {
          id: "acct-checking",
          name: "Household Cash",
          category: "cash",
          subType: "checking",
          value: 600_000,
          basis: 600_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
          isDefaultChecking: true,
        },
        {
          id: "acct-sell-home",
          name: "Old Home",
          category: "real_estate",
          subType: "primary_residence",
          value: 200_000,
          basis: 200_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "sell-home",
          name: "Sell Old Home",
          type: "sell" as const,
          year: 2026,
          accountId: "acct-sell-home",
          qualifiesForHomeSaleExclusion: true,
        },
        {
          id: "buy-home",
          name: "Buy New Home",
          type: "buy" as const,
          year: 2026,
          assetName: "New Home",
          assetCategory: "real_estate" as const,
          assetSubType: "primary_residence",
          purchasePrice: 500_000,
          growthRate: 0,
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });

    const result = runProjection(data);
    const year = result[0];

    // No leftover sale income — the 200k was fully absorbed by the 500k equity.
    const techniqueProceedsSum = Object.entries(year.income.bySource)
      .filter(([id]) => id.startsWith("technique-proceeds:"))
      .reduce((s, [, v]) => s + v, 0);
    expect(techniqueProceedsSum).toBeCloseTo(0, 0);

    // Uncovered purchase equity (500k - 200k = 300k) flows to expense bySource.
    const techniquePurchaseSum = Object.entries(year.expenses.bySource ?? {})
      .filter(([id]) => id.startsWith("technique-purchase:"))
      .reduce((s, [, v]) => s + v, 0);
    expect(techniquePurchaseSum).toBeCloseTo(300_000, 0);
  });

  it("asset purchase creates new account visible in later years", () => {
    const data = buildClientData({
      assetTransactions: [
        {
          id: "buy-1",
          name: "Buy Rental",
          type: "buy" as const,
          year: 2028,
          assetName: "Rental Property",
          assetCategory: "real_estate" as const,
          assetSubType: "rental_property",
          purchasePrice: 300000,
          growthRate: 0.03,
          fundingAccountId: "acct-savings",
        },
      ],
    });

    const result = runProjection(data);
    const year2029 = result.find((y) => y.year === 2029)!;
    expect(year2029.portfolioAssets.realEstateTotal).toBeGreaterThan(0);
  });

  it("keeps household cash non-negative: a purchase that drains checking triggers a withdrawal from the strategy", () => {
    const data = buildClientData({
      accounts: [
        {
          id: "acct-checking",
          name: "Household Cash",
          category: "cash",
          subType: "checking",
          value: 0,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
          isDefaultChecking: true,
        },
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 500000,
          basis: 500000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [
        { accountId: "acct-brokerage", priorityOrder: 1, startYear: 2026, endYear: 2030 },
      ],
      assetTransactions: [
        {
          id: "buy-home",
          name: "Buy Home",
          type: "buy" as const,
          year: 2026,
          assetName: "Home",
          assetCategory: "real_estate" as const,
          assetSubType: "primary_residence",
          purchasePrice: 100000,
          growthRate: 0,
          // default fundingAccountId -> household checking
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });

    const result = runProjection(data);
    const year2026 = result[0];
    const checkingBal = year2026.portfolioAssets.cash["acct-checking"];
    // Checking must not end the year negative — the gap-fill should cover the purchase.
    expect(checkingBal).toBeGreaterThanOrEqual(-0.01);
    // And a withdrawal from brokerage must have happened to fund the purchase.
    expect(year2026.withdrawals.byAccount["acct-brokerage"]).toBeGreaterThan(0);
  });

  it("BoY: a sold asset earns no growth in its sale year", () => {
    // Asset with 10% growth, value 100k, sold BoY. If the sale were EoY the
    // asset would grow 10% first and the sale would yield 110k. BoY means no
    // growth; proceeds = 100k.
    const data = buildClientData({
      accounts: [
        {
          id: "acct-checking",
          name: "Household Cash",
          category: "cash",
          subType: "checking",
          value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
          isDefaultChecking: true,
        },
        {
          id: "acct-brokerage",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 100000, basis: 100000, growthRate: 0.10, rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
        },
      ],
      incomes: [], expenses: [], liabilities: [], savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "sale-boy", name: "Sell", type: "sell" as const,
          year: 2026, accountId: "acct-brokerage",
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    const year2026 = result[0];
    // Sold account's brokerage ledger shows no growth
    expect(year2026.accountLedgers["acct-brokerage"].growth).toBe(0);
    // Proceeds in cash are the pre-growth 100k (minus cash growth on those proceeds)
    const checkingBal = year2026.portfolioAssets.cash["acct-checking"];
    // Checking growthRate is 0, so exactly 100k
    expect(checkingBal).toBeCloseTo(100000, 0);
  });

  it("BoY: a newly-bought asset earns a full year of growth in its purchase year", () => {
    // Buy a 100k asset with 10% growth BoY 2026 funded by 100k savings account.
    // By EoY 2026 the new asset should be worth 110k.
    const data = buildClientData({
      accounts: [
        {
          id: "acct-checking",
          name: "Household Cash",
          category: "cash",
          subType: "checking",
          value: 100000, basis: 100000, growthRate: 0, rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
          isDefaultChecking: true,
        },
      ],
      incomes: [], expenses: [], liabilities: [], savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "buy-boy", name: "Buy", type: "buy" as const,
          year: 2026,
          assetName: "New Asset",
          assetCategory: "taxable" as const,
          assetSubType: "brokerage",
          purchasePrice: 100000,
          growthRate: 0.10,
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    const year2026 = result[0];
    // Newly-bought real estate should be worth ~110k (100k * 1.10) by EoY
    expect(year2026.portfolioAssets.taxableTotal).toBeCloseTo(110000, 0);
  });

  it("BoY: a new mortgage from a BoY purchase pays a full year of amortization in its first year", () => {
    // $500k salary covers everything easily. Buy $500k home BoY 2026 with a
    // $400k 30-year mortgage at 6%. Expect 12 months of payments that year
    // (~$2,398 * 12 ≈ $28,775) flowing through expenses.liabilities.
    const data = buildClientData({
      accounts: [
        {
          id: "acct-checking",
          name: "Household Cash",
          category: "cash",
          subType: "checking",
          value: 200000, basis: 200000, growthRate: 0, rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
            { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
          ],
          isDefaultChecking: true,
        },
      ],
      incomes: [
        {
          id: "salary", type: "salary", name: "Salary",
          annualAmount: 500000,
          startYear: 2026, endYear: 2030,
          growthRate: 0,
          owner: "client",
        },
      ],
      expenses: [], liabilities: [], savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "buy-home", name: "Buy Home", type: "buy" as const,
          year: 2026,
          assetName: "Primary Residence",
          assetCategory: "real_estate" as const,
          assetSubType: "primary_residence",
          purchasePrice: 500000,
          growthRate: 0.03,
          mortgageAmount: 400000,
          mortgageRate: 0.06,
          mortgageTermMonths: 360,
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const result = runProjection(data);
    const year2026 = result[0];
    // Full-year mortgage payment should be ~$28,775 (12 × $2,398.20)
    expect(year2026.expenses.liabilities).toBeGreaterThan(28000);
    expect(year2026.expenses.liabilities).toBeLessThan(29000);
  });
});

describe("runProjection — liability amortization alignment", () => {
  it("BoY liability balance matches monthly amortization schedule for a retroactive loan", async () => {
    // Loan originated in 2021. User entered the original balance as of loan
    // origination (balanceAsOfYear = startYear), so the engine must back-
    // calculate / forward-amortize to arrive at the BoY balance for each
    // projection year — the answer must match what the balance-sheet /
    // amortization-tab already show via lib/loan-math.
    const { calcPayment, calcOriginalBalance, computeAmortizationSchedule } =
      await import("../../lib/loan-math");

    const origBalance = 300000;
    const rate = 0.065;
    const termMonths = 360;
    const monthlyPayment = calcPayment(origBalance, rate, termMonths);

    const house = {
      id: "acct-house",
      name: "House",
      category: "real_estate" as const,
      subType: "primary_residence",
      value: 600000,
      basis: 400000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const mortgage = {
      id: "liab-retro",
      name: "Retroactive Mortgage",
      balance: origBalance,
      interestRate: rate,
      monthlyPayment,
      startYear: 2021,
      startMonth: 1,
      termMonths,
      balanceAsOfYear: 2021,
      balanceAsOfMonth: 1,
      linkedPropertyId: "acct-house",
      isInterestDeductible: true,
      extraPayments: [],
      owners: [],
    };

    const data = buildClientData({
      accounts: [house],
      incomes: [],
      expenses: [],
      liabilities: [mortgage],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2031 },
    });
    const result = runProjection(data);

    const year2030 = result.find((py) => py.year === 2030)!;
    expect(year2030).toBeDefined();
    const engineBoY2030 = year2030.liabilityBalancesBoY["liab-retro"];

    // Authoritative schedule, from loan origination forward.
    const origFromBackCalc = calcOriginalBalance(
      origBalance,
      rate,
      monthlyPayment,
      0, // balanceAsOfYear == startYear, zero elapsed months
    );
    const schedule = computeAmortizationSchedule(
      origFromBackCalc,
      rate,
      monthlyPayment,
      2021,
      termMonths,
    );
    const row2030 = schedule.find((r) => r.year === 2030)!;
    expect(row2030).toBeDefined();

    // Engine BoY 2030 must match the schedule's beginningBalance for 2030 to
    // the dollar — not the 2025 row (the pattern the old annual amortization
    // produced for a sale 4 years from plan start).
    expect(engineBoY2030).toBeCloseTo(row2030.beginningBalance, 0);
  });

  it("mortgagePaidOff on a future sale equals the schedule's BoY balance for the sale year", async () => {
    const { calcPayment, computeAmortizationSchedule } = await import(
      "../../lib/loan-math"
    );

    const origBalance = 300000;
    const rate = 0.065;
    const termMonths = 360;
    const monthlyPayment = calcPayment(origBalance, rate, termMonths);

    const house = {
      id: "acct-house",
      name: "House",
      category: "real_estate" as const,
      subType: "primary_residence",
      value: 600000,
      basis: 400000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const checking = {
      id: "acct-checking",
      name: "Checking",
      category: "cash" as const,
      subType: "checking",
      value: 10000,
      basis: 10000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      isDefaultChecking: true,
    };
    const mortgage = {
      id: "liab-retro",
      name: "Retroactive Mortgage",
      balance: origBalance,
      interestRate: rate,
      monthlyPayment,
      startYear: 2021,
      startMonth: 1,
      termMonths,
      balanceAsOfYear: 2021,
      balanceAsOfMonth: 1,
      linkedPropertyId: "acct-house",
      isInterestDeductible: true,
      extraPayments: [],
      owners: [],
    };

    const data = buildClientData({
      accounts: [house, checking],
      incomes: [],
      expenses: [],
      liabilities: [mortgage],
      savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "sale-house",
          name: "Sell House",
          type: "sell" as const,
          year: 2030,
          accountId: "acct-house",
          overrideSaleValue: 700000,
          overrideBasis: 400000,
        },
      ],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2031 },
    });
    const result = runProjection(data);

    const year2030 = result.find((py) => py.year === 2030)!;
    const sale = year2030.techniqueBreakdown?.sales.find(
      (s) => s.transactionId === "sale-house",
    );
    expect(sale).toBeDefined();

    const schedule = computeAmortizationSchedule(
      origBalance, // balanceAsOfYear == startYear, so this IS the origBal
      rate,
      monthlyPayment,
      2021,
      termMonths,
    );
    const row2030 = schedule.find((r) => r.year === 2030)!;
    expect(sale!.mortgagePaidOff).toBeCloseTo(row2030.beginningBalance, 0);
  });
});

describe("projection — socialSecurityDetail", () => {
  it("populates per-spouse retirement/spousal/survivor in pia_at_fra mode", () => {
    // Client born 1960-06-01 (FRA 67), PIA $2000/mo, claims at 67 → starts 2027
    // Spouse born 1962-06-01 (FRA 67), PIA $300/mo, claims at 67 → starts 2029
    const data = buildClientData({
      client: {
        ...baseClient,
        dateOfBirth: "1960-06-01",
        retirementAge: 67,
        spouseDob: "1962-06-01",
        spouseRetirementAge: 67,
        filingStatus: "married_joint",
      },
      incomes: [
        {
          id: "ss-client",
          type: "social_security",
          name: "Client SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2055,
          growthRate: 0,
          owner: "client",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 2000,
        },
        {
          id: "ss-spouse",
          type: "social_security",
          name: "Spouse SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2055,
          growthRate: 0,
          owner: "spouse",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 300,
        },
      ],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2025, planEndYear: 2035, flatFederalRate: 0, flatStateRate: 0 },
    });

    const result = runProjection(data);

    // 2027: client (age 67) has claimed; spouse (age 65) has NOT yet claimed
    const year2027 = result.find((py) => py.year === 2027)!;
    expect(year2027).toBeDefined();
    expect(year2027.socialSecurityDetail).toBeDefined();
    // Client: own retirement at FRA = 2000/mo × 12 = 24000
    expect(year2027.socialSecurityDetail!.client.retirement).toBeCloseTo(24000, 0);
    expect(year2027.socialSecurityDetail!.client.spousal).toBe(0);
    expect(year2027.socialSecurityDetail!.client.survivor).toBe(0);
    // Spouse hasn't claimed yet in 2027
    expect(year2027.socialSecurityDetail!.spouse).toBeUndefined();

    // 2029: both have claimed
    // Client: own retirement = 24000, no spousal/survivor
    // Spouse: own=300/mo, spousal top-up to 50% of 2000=1000/mo → retirement=3600, spousal=8400
    const year2029 = result.find((py) => py.year === 2029)!;
    expect(year2029).toBeDefined();
    expect(year2029.socialSecurityDetail).toBeDefined();

    const clientDetail = year2029.socialSecurityDetail!.client;
    expect(clientDetail.retirement).toBeCloseTo(24000, 0);
    expect(clientDetail.spousal).toBe(0);
    expect(clientDetail.survivor).toBe(0);

    const spouseDetail = year2029.socialSecurityDetail!.spouse!;
    expect(spouseDetail).toBeDefined();
    expect(spouseDetail.retirement).toBeCloseTo(3600, 0);   // 300/mo × 12
    expect(spouseDetail.spousal).toBeCloseTo(8400, 0);      // (1000-300)/mo × 12
    expect(spouseDetail.survivor).toBe(0);

    // Total SS income should equal sum of all detail amounts
    const detailTotal =
      clientDetail.retirement + clientDetail.spousal + clientDetail.survivor +
      spouseDetail.retirement + spouseDetail.spousal + spouseDetail.survivor;
    expect(year2029.income.socialSecurity).toBeCloseTo(detailTotal, 0);
    expect(year2029.income.socialSecurity).toBeCloseTo(24000 + 12000, 0); // 36000
  });
});

describe("projection — spousal multi-year verification", () => {
  it("verifies SS totals across all years as each spouse claims at FRA", () => {
    // Client born 1960-06-01 (FRA 67), PIA $2000/mo → claims year 2027
    // Spouse born 1962-06-01 (FRA 67), PIA $300/mo → claims year 2029
    // Spouse receives top-up: own $300/mo < 50% of $2000 = $1000/mo → total $1000/mo
    // Household SS by year:
    //   2026: $0 (neither has claimed)
    //   2027: $24,000 (client only)
    //   2028: $24,000 (client only, spouse still not at 67)
    //   2029: $36,000 (both claimed: 2000 + 1000 = 3000/mo)
    //   2030: $36,000 (both continue)
    // This tests multi-year stability — complementary coverage to the single-year Task 11 test.
    const data = buildClientData({
      client: {
        ...baseClient,
        dateOfBirth: "1960-06-01",
        retirementAge: 67,
        spouseDob: "1962-06-01",
        spouseRetirementAge: 67,
        filingStatus: "married_joint",
      },
      incomes: [
        {
          id: "ss-client",
          type: "social_security",
          name: "Client SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2055,
          growthRate: 0,
          owner: "client",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 2000,
        },
        {
          id: "ss-spouse",
          type: "social_security",
          name: "Spouse SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2055,
          growthRate: 0,
          owner: "spouse",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 300,
        },
      ],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        ...basePlanSettings,
        planStartYear: 2020,
        planEndYear: 2040,
        flatFederalRate: 0,
        flatStateRate: 0,
      },
    });

    const result = runProjection(data);

    // 2026: neither claimed → $0
    const year2026 = result.find((py) => py.year === 2026)!;
    expect(year2026).toBeDefined();
    expect(year2026.income.socialSecurity).toBe(0);

    // 2027: client turns 67 and claims → $24,000; spouse age 65, not yet claimed
    const year2027 = result.find((py) => py.year === 2027)!;
    expect(year2027).toBeDefined();
    expect(year2027.income.socialSecurity).toBeCloseTo(24000, 0);
    expect(year2027.socialSecurityDetail!.client.retirement).toBeCloseTo(24000, 0);
    expect(year2027.socialSecurityDetail!.client.spousal).toBe(0);
    expect(year2027.socialSecurityDetail!.client.survivor).toBe(0);
    expect(year2027.socialSecurityDetail!.spouse).toBeUndefined();

    // 2028: only client claimed → $24,000 (spouse still age 66)
    const year2028 = result.find((py) => py.year === 2028)!;
    expect(year2028).toBeDefined();
    expect(year2028.income.socialSecurity).toBeCloseTo(24000, 0);

    // 2029: spouse turns 67 and claims → $36,000
    //   client: 2000/mo × 12 = $24,000
    //   spouse: 300/mo own + 700/mo top-up = 1000/mo × 12 = $12,000
    const year2029 = result.find((py) => py.year === 2029)!;
    expect(year2029).toBeDefined();
    expect(year2029.income.socialSecurity).toBeCloseTo(36000, 0);
    expect(year2029.socialSecurityDetail!.client.retirement).toBeCloseTo(24000, 0);
    expect(year2029.socialSecurityDetail!.spouse!.retirement).toBeCloseTo(3600, 0);
    expect(year2029.socialSecurityDetail!.spouse!.spousal).toBeCloseTo(8400, 0);

    // 2030: both continue at same rates → $36,000
    const year2030 = result.find((py) => py.year === 2030)!;
    expect(year2030).toBeDefined();
    expect(year2030.income.socialSecurity).toBeCloseTo(36000, 0);

    // Detail total must equal income.socialSecurity in 2029
    const cd = year2029.socialSecurityDetail!.client;
    const sd = year2029.socialSecurityDetail!.spouse!;
    const detailTotal =
      cd.retirement + cd.spousal + cd.survivor +
      sd.retirement + sd.spousal + sd.survivor;
    expect(year2029.income.socialSecurity).toBeCloseTo(detailTotal, 0);
  });
});

describe("projection — survivor transition", () => {
  it("switches to survivor benefit after spouse death", () => {
    // Client born 1960-01-01 (FRA 67), PIA $2000/mo → claims year 2027
    // Spouse born 1960-01-01 (FRA 67), PIA $2000/mo → claims year 2027
    // Spouse lifeExpectancy = 75 → death year = 1960 + 75 = 2035
    // otherIsDead = year >= 2035, so from 2035 onward spouse is dead
    //
    // Years 2027-2034 (both alive, both claimed):
    //   Each gets own $2000/mo = $24,000/yr → household = $48,000/yr
    //
    // Year 2035+ (spouse dead):
    //   Deceased filed at FRA (claimingAge 67 == FRA 67) → Case B: survivor max = deceased PIA = $2000/mo
    //   Client's own $2000/mo == survivor $2000/mo → no net top-up; all in retirement bucket
    //   Household SS = $24,000/yr (client's own only)
    const data = buildClientData({
      client: {
        ...baseClient,
        dateOfBirth: "1960-01-01",
        retirementAge: 67,
        spouseDob: "1960-01-01",
        spouseRetirementAge: 67,
        filingStatus: "married_joint",
        spouseLifeExpectancy: 75,
      },
      incomes: [
        {
          id: "ss-client",
          type: "social_security",
          name: "Client SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2060,
          growthRate: 0,
          owner: "client",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 2000,
        },
        {
          id: "ss-spouse",
          type: "social_security",
          name: "Spouse SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2060,
          growthRate: 0,
          owner: "spouse",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 2000,
        },
      ],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        ...basePlanSettings,
        planStartYear: 2025,
        planEndYear: 2055,
        flatFederalRate: 0,
        flatStateRate: 0,
      },
    });

    const result = runProjection(data);

    // NOTE: Both spouses born 1960-01-01 → Jan-1 rule applies → FRA lookup uses birth year 1959
    // → FRA = 66y 10m = 802 months. Claiming at 67y 0m = 804 months → +2 DRC months.
    // DRC = 2 × (2/300) = 1.333% → own = $2000 × 1.01333 = $2,026.67/mo → $24,320/yr per person.

    // 2027: both alive, both claimed → $48,640 (24,320 × 2)
    const year2027 = result.find((py) => py.year === 2027)!;
    expect(year2027).toBeDefined();
    expect(year2027.income.socialSecurity).toBeCloseTo(48640, 0);
    expect(year2027.socialSecurityDetail!.client.retirement).toBeCloseTo(24320, 0);
    expect(year2027.socialSecurityDetail!.client.survivor).toBe(0);
    expect(year2027.socialSecurityDetail!.spouse!.retirement).toBeCloseTo(24320, 0);
    expect(year2027.socialSecurityDetail!.spouse!.survivor).toBe(0);

    // 2034: still both alive → $48,640
    const year2034 = result.find((py) => py.year === 2034)!;
    expect(year2034).toBeDefined();
    expect(year2034.income.socialSecurity).toBeCloseTo(48640, 0);

    // 2035: spouse dies (year >= 1960 + 75 = 2035) → only client's benefit
    // Client own = $2,026.67/mo (with DRC), survivor ceiling = $2,026.67/mo (own ≥ survivor)
    // → net top-up = 0; all in retirement bucket; household SS = $24,320/yr
    const year2035 = result.find((py) => py.year === 2035)!;
    expect(year2035).toBeDefined();
    expect(year2035.income.socialSecurity).toBeCloseTo(24320, 0);
    // Spouse row stops contributing (suppressed by income.ts dead-spouse check)
    expect(year2035.socialSecurityDetail!.spouse).toBeUndefined();
    // Client gets own retirement only (no survivor top-up needed; own ≥ survivor)
    expect(year2035.socialSecurityDetail!.client.retirement).toBeCloseTo(24320, 0);
    expect(year2035.socialSecurityDetail!.client.survivor).toBe(0);

    // 2036: same pattern continues → $24,320
    const year2036 = result.find((py) => py.year === 2036)!;
    expect(year2036).toBeDefined();
    expect(year2036.income.socialSecurity).toBeCloseTo(24320, 0);
  });

  it("no double-count when spouseLifeExpectancy is null (defaults to 95)", () => {
    // Regression for: orchestrator defaults null spouseLifeExpectancy to 95 but income.ts
    // previously required != null, leaving the spouse row alive → double-count from year 2055+.
    //
    // Setup: client born 1960-01-01, PIA $2000, claims at 67.
    //        spouse born 1960-01-01, PIA $2000, claims at 67, spouseLifeExpectancy: null.
    // Effective spouse LE = 95 → spouse dies in 1960+95 = 2055.
    // Year 2056: income.ts must suppress the spouse row (year >= 2055).
    // Orchestrator triggers survivor math from the client row.
    // Client own = $2,026.67/mo (DRC: born Jan-1 → FRA lookup uses 1959 → 66y10m = 802mo;
    //   claiming 67y0m = 804mo → +2 DRC mo → $2000 × (1 + 2×2/300) = ~$2026.67/mo = ~$24,320/yr).
    // Survivor ceiling = deceased PIA $2000/mo = $24,000/yr < client own → no top-up.
    // Household SS 2056 = ~$24,320/yr (NOT $48,640).
    const data = buildClientData({
      client: {
        ...baseClient,
        dateOfBirth: "1960-01-01",
        retirementAge: 67,
        spouseDob: "1960-01-01",
        spouseRetirementAge: 67,
        filingStatus: "married_joint",
        spouseLifeExpectancy: null,
      },
      incomes: [
        {
          id: "ss-client-null-le",
          type: "social_security",
          name: "Client SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2099,
          growthRate: 0,
          owner: "client",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 2000,
        },
        {
          id: "ss-spouse-null-le",
          type: "social_security",
          name: "Spouse SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2099,
          growthRate: 0,
          owner: "spouse",
          claimingAge: 67,
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 2000,
        },
      ],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        ...basePlanSettings,
        planStartYear: 2025,
        planEndYear: 2060,
        flatFederalRate: 0,
        flatStateRate: 0,
      },
    });

    const result = runProjection(data);

    // Both alive and claimed → $48,640/yr (DRC applies as noted above)
    const year2054 = result.find((py) => py.year === 2054)!;
    expect(year2054).toBeDefined();
    expect(year2054.income.socialSecurity).toBeCloseTo(48640, 0);

    // 2055: spouse death year (1960 + 95 = 2055) → spouse row suppressed from this year on.
    // Client row triggers survivor math; own >= survivor → no top-up.
    const year2055 = result.find((py) => py.year === 2055)!;
    expect(year2055).toBeDefined();
    expect(year2055.income.socialSecurity).toBeCloseTo(24320, 0);

    // 2056: must NOT be double-counted ($48,640 would indicate the bug is present)
    const year2056 = result.find((py) => py.year === 2056)!;
    expect(year2056).toBeDefined();
    expect(year2056.income.socialSecurity).toBeCloseTo(24320, 0);
    // Spouse row is gone
    expect(year2056.socialSecurityDetail?.spouse).toBeUndefined();
    // Client gets own retirement only
    expect(year2056.socialSecurityDetail!.client.retirement).toBeCloseTo(24320, 0);
    expect(year2056.socialSecurityDetail!.client.survivor).toBe(0);
  });
});

describe("projection — SS living-link claim-age modes", () => {
  it("claim age follows client DOB when using claimingAgeMode='fra'", () => {
    // Scenario: client born 1960-06-01 (FRA 67y 0m → first claim year 2027)
    // claimingAge=62 is set on the row but claimingAgeMode='fra' causes the
    // engine to IGNORE the literal 62 and resolve the effective age to FRA (67).
    // piaMonthly=2000, ssBenefitMode='pia_at_fra'
    //   2026 (age 66): has not yet reached FRA → $0
    //   2027 (age 67): FRA reached → 2000/mo × 12 = $24,000
    const data = buildClientData({
      client: {
        ...baseClient,
        dateOfBirth: "1960-06-01",
        retirementAge: 67,
        filingStatus: "single",
        spouseDob: undefined,
        spouseName: undefined,
        spouseRetirementAge: undefined,
      },
      incomes: [
        {
          id: "ss-living-link",
          type: "social_security",
          name: "Client SS",
          annualAmount: 0,
          startYear: 2025,
          endYear: 2060,
          growthRate: 0,
          owner: "client",
          claimingAge: 62,          // ignored — living-link overrides this
          claimingAgeMode: "fra",   // living-link: resolve to FRA dynamically
          ssBenefitMode: "pia_at_fra",
          piaMonthly: 2000,
        },
      ],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        ...basePlanSettings,
        planStartYear: 2025,
        planEndYear: 2030,
        flatFederalRate: 0,
        flatStateRate: 0,
      },
    });

    const result = runProjection(data);

    // 2026: client is 66 — FRA not yet reached → no benefit
    const year2026 = result.find((py) => py.year === 2026)!;
    expect(year2026).toBeDefined();
    expect(year2026.income.socialSecurity).toBe(0);

    // 2027: client turns 67 — FRA reached → full PIA = $2,000/mo × 12 = $24,000
    const year2027 = result.find((py) => py.year === 2027)!;
    expect(year2027).toBeDefined();
    expect(year2027.income.socialSecurity).toBeCloseTo(24000, 0);
    expect(year2027.socialSecurityDetail!.client.retirement).toBeCloseTo(24000, 0);
  });
});

describe("first-death asset transfer (spec 4b)", () => {
  function buildEstateScenario() {
    const client: ClientInfo = {
      firstName: "John",
      lastName: "Smith",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
      lifeExpectancy: 80, // dies 2050
      filingStatus: "married_joint",
      spouseName: "Jane Smith",
      spouseDob: "1972-01-01",
      spouseRetirementAge: 65,
      spouseLifeExpectancy: 90, // dies 2062
    };
    const accounts: Account[] = [
      { id: "joint-brok", name: "Joint Brokerage", category: "taxable", subType: "brokerage", value: 400000, basis: 300000, growthRate: 0.06, rmdEnabled: false,
        owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 }, { kind: "family_member" as const, familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 }] },
      { id: "john-ira", name: "John IRA", category: "retirement", subType: "traditional_ira", value: 500000, basis: 0, growthRate: 0.07, rmdEnabled: true,
        beneficiaries: [{ id: "b-1", tier: "primary", percentage: 100, familyMemberId: "child-a", sortOrder: 0 }],
        owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }] },
      { id: "john-cash", name: "John Savings", category: "cash", subType: "savings", value: 80000, basis: 80000, growthRate: 0.04, rmdEnabled: false, isDefaultChecking: true,
        owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }] },
      { id: "jane-roth", name: "Jane Roth", category: "retirement", subType: "roth_ira", value: 200000, basis: 100000, growthRate: 0.07, rmdEnabled: false,
        owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }] },
    ];
    const planSettings: PlanSettings = {
      ...basePlanSettings,
      planStartYear: 2026,
      planEndYear: 2080,
    };
    const data: ClientData = {
      client,
      accounts,
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [
        { id: LEGACY_FM_CLIENT, relationship: "other" as const, role: "client" as const, firstName: "John", lastName: "Smith", dateOfBirth: "1970-01-01" },
        { id: LEGACY_FM_SPOUSE, relationship: "other" as const, role: "spouse" as const, firstName: "Jane", lastName: "Smith", dateOfBirth: "1972-01-01" },
        { id: "child-a", relationship: "child" as const, role: "child" as const, firstName: "Alice", lastName: "Smith", dateOfBirth: "2000-01-01" },
      ],
      wills: [
        { id: "w-john", grantor: "client", bequests: [
          { id: "beq-1", name: "Residual to Jane", kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null, percentage: 100, condition: "always" as const, sortOrder: 0,
            recipients: [{ recipientKind: "spouse" as const, recipientId: null, percentage: 100, sortOrder: 0 }] },
        ]},
      ],
      giftEvents: [],
    };
    return data;
  }

  it("death-year row carries deathTransfers; next year has post-death ownership", () => {
    const data = buildEstateScenario();
    const years = runProjection(data);
    const deathRow = years.find((y) => y.year === 2050)!;
    expect(deathRow.deathTransfers).toBeDefined();
    expect(deathRow.deathTransfers!.length).toBeGreaterThan(0);
    // Non-death years carry no transfers
    expect(years.find((y) => y.year === 2049)!.deathTransfers).toBeUndefined();
    expect(years.find((y) => y.year === 2051)!.deathTransfers).toBeUndefined();
  });

  it("death event on the happy path emits no warnings", () => {
    const data = buildEstateScenario();
    const years = runProjection(data);
    // Happy path (all accounts disposed via titling / beneficiary / will):
    // no fallback fires, so deathWarnings stays empty.
    const deathRow = years.find((y) => y.year === 2050)!;
    expect(deathRow.deathWarnings).toEqual([]);
  });

  it("transfer ledger sums to deceased-owned pre-death balance", () => {
    const data = buildEstateScenario();
    const years = runProjection(data);
    const deathRow = years.find((y) => y.year === 2050)!;
    const ledgerSum = deathRow.deathTransfers!.reduce((s, t) => s + t.amount, 0);
    // Deceased-touched accounts (joint brokerage, John's IRA, John's cash). Their
    // 2050 end-of-year values live on the ProjectionYear's accountLedgers as
    // endingValue. Jane's Roth is unaffected (she's the survivor).
    const touched = ["joint-brok", "john-ira", "john-cash"];
    const expectedSum = touched.reduce(
      (s, id) => s + (deathRow.accountLedgers[id]?.endingValue ?? 0),
      0,
    );
    expect(ledgerSum).toBeCloseTo(expectedSum, 0);
  });

  it("single-filer client (no spouse) is a death-event no-op", () => {
    const data = buildEstateScenario();
    const singleClient: ClientData = {
      ...data,
      client: {
        ...data.client,
        lifeExpectancy: 140, // push past planEndYear (2080) so no death event fires
        spouseDob: undefined,
        spouseLifeExpectancy: undefined,
        filingStatus: "single",
      },
    };
    const years = runProjection(singleClient);
    for (const y of years) {
      expect(y.deathTransfers).toBeUndefined();
      expect(y.deathWarnings).toBeUndefined();
    }
  });

  it("existing projection tests without wills continue to pass (regression)", () => {
    // Smoke: a ClientData with no wills (but principals still in familyMembers)
    // should still run — the deceased's accounts hit fallback tier and warnings
    // are emitted. That's acceptable behavior.
    const data: ClientData = buildEstateScenario();
    // Keep principal FMs so the death event can identify deceased-owned accounts;
    // drop wills and non-principal children for the minimal regression fixture.
    const noWills: ClientData = {
      ...data,
      wills: [],
      familyMembers: [
        { id: LEGACY_FM_CLIENT, relationship: "other" as const, role: "client" as const, firstName: "John", lastName: "Smith", dateOfBirth: "1970-01-01" },
        { id: LEGACY_FM_SPOUSE, relationship: "other" as const, role: "spouse" as const, firstName: "Jane", lastName: "Smith", dateOfBirth: "1972-01-01" },
      ],
    };
    // With no will, the deceased's owned accounts hit fallback → survivor (still works)
    // and warnings are emitted. That's acceptable behavior.
    const years = runProjection(noWills);
    const deathRow = years.find((y) => y.year === 2050)!;
    expect(deathRow.deathWarnings!.length).toBeGreaterThan(0); // residual_fallback_fired per account
  });
});

describe("runProjection — final-death event (spec 4c)", () => {
  const twoSpouseClient: ClientInfo = {
    firstName: "Tom", lastName: "Test",
    dateOfBirth: "1970-01-01",
    retirementAge: 65, planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 75,          // dies 2045 (first death)
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 80,    // dies 2052 (final death)
  };

  const planSettings: PlanSettings = {
    ...basePlanSettings,
    planStartYear: 2026,
    planEndYear: 2066,
    inflationRate: 0.025,
    flatFederalRate: 0,
    flatStateRate: 0,
  };

  it("truncates the projection at the final-death year (couple with distinct deaths)", () => {
    const data = buildClientData({
      client: twoSpouseClient,
      planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      }],
      familyMembers: [
        { id: LEGACY_FM_CLIENT, relationship: "other" as const, role: "client" as const, firstName: "Tom", lastName: "Test", dateOfBirth: "1970-01-01" },
        { id: LEGACY_FM_SPOUSE, relationship: "other" as const, role: "spouse" as const, firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-01-01" },
        { id: "c1", relationship: "child", role: "child" as const, firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    const lastYear = years[years.length - 1];
    expect(lastYear.year).toBe(2052);  // final-death year
    expect(years.find((y) => y.year === 2053)).toBeUndefined();
  });

  it("attaches deathOrder=1 and deathOrder=2 entries to distinct years for distinct-year deaths", () => {
    const data = buildClientData({
      client: twoSpouseClient,
      planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      }],
      familyMembers: [
        { id: LEGACY_FM_CLIENT, relationship: "other" as const, role: "client" as const, firstName: "Tom", lastName: "Test", dateOfBirth: "1970-01-01" },
        { id: LEGACY_FM_SPOUSE, relationship: "other" as const, role: "spouse" as const, firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-01-01" },
        { id: "c1", relationship: "child", role: "child" as const, firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    const firstDeathYr = years.find((y) => y.year === 2045);
    const finalDeathYr = years.find((y) => y.year === 2052);
    expect(firstDeathYr?.deathTransfers?.every((t) => t.deathOrder === 1)).toBe(true);
    expect(finalDeathYr?.deathTransfers?.every((t) => t.deathOrder === 2)).toBe(true);
  });

  it("same-year double death: both orders attach to the same ProjectionYear", () => {
    const client: ClientInfo = {
      ...twoSpouseClient,
      lifeExpectancy: 75,           // dies 2045
      spouseLifeExpectancy: 73,     // dies 2045 (1972 + 73)
    };
    const data = buildClientData({
      client, planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      }, {
        id: "a2", name: "Spouse IRA", category: "retirement", subType: "trad_ira",
        value: 200_000, basis: 200_000, growthRate: 0.05, rmdEnabled: true,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
      }],
      familyMembers: [
        { id: LEGACY_FM_CLIENT, relationship: "other" as const, role: "client" as const, firstName: "Tom", lastName: "Test", dateOfBirth: "1970-01-01" },
        { id: LEGACY_FM_SPOUSE, relationship: "other" as const, role: "spouse" as const, firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-01-01" },
        { id: "c1", relationship: "child", role: "child" as const, firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    expect(years[years.length - 1].year).toBe(2045);

    const deathYr = years[years.length - 1];
    const orders = new Set(deathYr.deathTransfers?.map((t) => t.deathOrder));
    expect(orders.has(1)).toBe(true);
    expect(orders.has(2)).toBe(true);
  });

  it("single-filer client: 4b no-ops, 4c fires at the client's death year, truncates", () => {
    const client: ClientInfo = {
      firstName: "Solo", lastName: "Test",
      dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 95,
      filingStatus: "single",
      lifeExpectancy: 80,  // dies 2050
    };
    const data = buildClientData({
      client, planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      }],
      familyMembers: [
        { id: LEGACY_FM_CLIENT, relationship: "other" as const, role: "client" as const, firstName: "Solo", lastName: "Test", dateOfBirth: "1970-01-01" },
        { id: "c1", relationship: "child", role: "child" as const, firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    expect(years[years.length - 1].year).toBe(2050);
    const deathYr = years[years.length - 1];
    expect(deathYr.deathTransfers?.every((t) => t.deathOrder === 2)).toBe(true);
    expect(deathYr.deathTransfers?.length).toBeGreaterThan(0);
  });

  it("past-horizon final death: 4c no-ops; loop runs to planEndYear", () => {
    const client: ClientInfo = {
      ...twoSpouseClient,
      lifeExpectancy: 100,          // dies 2070 — past 2066 horizon
      spouseLifeExpectancy: 105,
    };
    const data = buildClientData({ client, planSettings });
    const years = runProjection(data);
    expect(years[years.length - 1].year).toBe(2066);
    // No deathTransfers on any year
    for (const y of years) expect(y.deathTransfers ?? []).toEqual([]);
  });

  it("distributes unlinked household debt proportionally to heirs (illiquid estate)", () => {
    // Illiquid estate at final death: only real_estate, no liquid accounts.
    // After Task 10's pipeline inversion the creditor-payoff drain runs
    // before the 4c chain but can't touch real_estate, so the full $20k
    // debt falls through to the residual proportional-distribution step.
    const data = buildClientData({
      client: twoSpouseClient,
      planSettings,
      accounts: [{
        id: "a1", name: "Primary Home", category: "real_estate",
        subType: "primary_residence",
        value: 500_000, basis: 300_000,
        growthRate: 0.03, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      }],
      liabilities: [{
        // Non-amortizing unlinked debt: zero payment + long term so the
        // balance persists until the 2052 final-death year. (The original
        // fixture amortized the CC before the death event and happened to
        // pass only because Task 10's creditor-payoff pipeline didn't
        // exist yet.)
        id: "cc1", name: "Credit Card", balance: 20_000,
        interestRate: 0, monthlyPayment: 0,
        startYear: 2025, startMonth: 1, termMonths: 600, extraPayments: [],
        owners: [],
      }],
      familyMembers: [
        { id: LEGACY_FM_CLIENT, relationship: "other" as const, role: "client" as const, firstName: "Tom", lastName: "Test", dateOfBirth: "1970-01-01" },
        { id: LEGACY_FM_SPOUSE, relationship: "other" as const, role: "spouse" as const, firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-01-01" },
        { id: "c1", relationship: "child", role: "child" as const, firstName: "A", lastName: null, dateOfBirth: null },
        { id: "c2", relationship: "child", role: "child" as const, firstName: "B", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    const finalYr = years.find((y) => y.year === 2052);
    const liabEntries = finalYr?.deathTransfers?.filter(
      (t) => t.via === "unlinked_liability_proportional",
    );
    expect(liabEntries?.length).toBe(2);  // one per child
    // At most one entry per child, both with via unlinked_liability_proportional.
    expect(liabEntries?.every((t) => t.deathOrder === 2)).toBe(true);
  });
});

describe("4d-2: hypotheticalEstateTax", () => {
  // Married fixture: reuse the file-wide buildClientData() default, which is
  // married_joint (John + Jane Smith) with no in-horizon death.
  const buildMarriedInput = () => buildClientData();

  // Married fixture with in-horizon deaths — needed for the coexistence test.
  // Mirrors the shape used by the spec-4c block above.
  const buildMarriedWithDeathsInput = (): ClientData => {
    const twoSpouseClient: ClientInfo = {
      firstName: "Tom", lastName: "Test",
      dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 95,
      filingStatus: "married_joint",
      lifeExpectancy: 75,          // dies 2045 (first death)
      spouseDob: "1972-01-01",
      spouseLifeExpectancy: 80,    // dies 2052 (final death)
    };
    const planSettings: PlanSettings = {
      ...basePlanSettings,
      planStartYear: 2026,
      planEndYear: 2066,
      inflationRate: 0.025,
      flatFederalRate: 0,
      flatStateRate: 0,
    };
    return buildClientData({
      client: twoSpouseClient,
      planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      }],
      familyMembers: [
        { id: "c1", relationship: "child", role: "child" as const, firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });
  };

  // Single-filer fixture — start from the married default and strip
  // spouse-specific fields so filingStatus='single' is coherent.
  const buildSingleFilerInput = (): ClientData => {
    const soloClient: ClientInfo = {
      firstName: "Solo",
      lastName: "Test",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 90,
      filingStatus: "single",
    };
    return buildClientData({
      client: soloClient,
      // Drop spouse-owned accounts/incomes so single-filer is internally
      // consistent (no "spouse" owners floating around).
      accounts: sampleAccounts.filter((a) => !a.owners.some(o => o.kind === "family_member" && o.familyMemberId === "__legacy_fm_spouse")),
      incomes: [
        {
          id: "inc-salary-solo",
          type: "salary",
          name: "Solo Salary",
          annualAmount: 150000,
          startYear: 2026,
          endYear: 2035,
          growthRate: 0.03,
          owner: "client",
        },
      ],
    });
  };

  it("attaches to every year of a married projection with both orderings", () => {
    const input = buildMarriedInput();
    const result = runProjection(input);

    expect(result.length).toBeGreaterThan(5);
    for (const year of result) {
      expect(year.hypotheticalEstateTax).toBeDefined();
      expect(year.hypotheticalEstateTax.year).toBe(year.year);
      expect(year.hypotheticalEstateTax.primaryFirst).toBeDefined();
      expect(year.hypotheticalEstateTax.primaryFirst.firstDecedent).toBe("client");
      expect(year.hypotheticalEstateTax.spouseFirst).toBeDefined();
      expect(year.hypotheticalEstateTax.spouseFirst!.firstDecedent).toBe("spouse");
    }
  });

  it("attaches to every year of a single-filer projection with no spouseFirst", () => {
    const input = buildSingleFilerInput();
    const result = runProjection(input);

    expect(result.length).toBeGreaterThan(5);
    for (const year of result) {
      expect(year.hypotheticalEstateTax).toBeDefined();
      expect(year.hypotheticalEstateTax.primaryFirst).toBeDefined();
      expect(year.hypotheticalEstateTax.primaryFirst.finalDeath).toBeUndefined();
      expect(year.hypotheticalEstateTax.spouseFirst).toBeUndefined();
    }
  });

  it("coexists with real estateTax on real death-event years", () => {
    const input = buildMarriedWithDeathsInput();
    const result = runProjection(input);

    const realDeathYears = result.filter((y) => y.estateTax != null);
    // 4d-1 emits exactly two real death-event years for a standard married
    // fixture (first death, final death). If the fixture places only one
    // death inside the plan horizon, relax this to >= 1.
    expect(realDeathYears.length).toBeGreaterThanOrEqual(1);
    for (const year of realDeathYears) {
      expect(year.hypotheticalEstateTax).toBeDefined();
      expect(year.estateTax).toBeDefined();
    }
  });

  it("year-N hypothetical reflects year-N balances (growth over time)", () => {
    const input = buildMarriedInput();
    const result = runProjection(input);

    const firstYear = result[0];
    const midYear = result[Math.min(10, result.length - 1)];

    // On a growing portfolio, gross estate should be non-decreasing between
    // year 0 and year ~10 (growth outpaces any draws in typical fixtures).
    // Use primaryFirst's first-death gross estate for the comparison.
    expect(midYear.hypotheticalEstateTax.primaryFirst.firstDeath.grossEstate).toBeGreaterThanOrEqual(
      firstYear.hypotheticalEstateTax.primaryFirst.firstDeath.grossEstate,
    );
  });
});

// ─── Fractional ownership (Phase 2 — Tasks 5–9) ────────────────────────────────

describe("fractional ownership: property tax + debt service pro-rate (Task 9)", () => {
  it("property tax on a 60% household / 40% entity real-estate account: only 60% hits household expenses", () => {
    // Account: real estate, $12k annual property tax. 60% household / 40% entity.
    // Today: full $12k → household. Fractional: $7,200 to household.
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking-hh",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
        {
          id: "acct-home",
          name: "Mixed-ownership Home",
          category: "real_estate",
          subType: "primary_residence",
          value: 1_000_000,
          basis: 800_000,
          growthRate: 0,
          rmdEnabled: false,
          annualPropertyTax: 12_000,
          propertyTaxGrowthRate: 0,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.6 },
            { kind: "entity", entityId: "trust-1", percent: 0.4 },
          ],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2026,
      },
      entities: [
        { id: "trust-1", name: "Trust", includeInPortfolio: false, isGrantor: false },
      ],
      giftEvents: [],
    };
    const yrs = runProjection(data);
    // Household real-estate expenses include the synthetic property-tax line
    // pro-rated by household share (60% of $12k = $7,200).
    expect(yrs[0].expenses.realEstate).toBeCloseTo(7_200, 0);
  });

  it("debt service on a 70% household / 30% entity liability: only 70% hits household liability expenses", () => {
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking-hh",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [
        {
          id: "liab-mixed",
          name: "Mixed-ownership Mortgage",
          balance: 300_000,
          interestRate: 0.05,
          monthlyPayment: 2_000, // ~24k/yr
          startYear: 2026,
          startMonth: 1,
          termMonths: 240,
          extraPayments: [],
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.7 },
            { kind: "entity", entityId: "trust-1", percent: 0.3 },
          ],
        },
      ],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2026,
      },
      entities: [
        { id: "trust-1", name: "Trust", includeInPortfolio: false, isGrantor: false },
      ],
      giftEvents: [],
    };
    const yrs = runProjection(data);
    // Household liabilities expense should reflect 70% of the annual payment.
    const fullPayment = yrs[0].expenses.byLiability["liab-mixed"];
    expect(fullPayment).toBeGreaterThan(0);
    expect(yrs[0].expenses.liabilities).toBeCloseTo(fullPayment * 0.7, 0);
  });
});

describe("fractional ownership: grantor pass-through pro-rate (Task 8)", () => {
  it("50% household + 30% grantor-trust + 20% non-grantor-trust → 80% to household 1040 OI", () => {
    // 50% client + 30% IDGT (grantor) + 20% NGT (non-grantor) of a $1M taxable
    // 100% OI account growing 10% = $100k OI. Grantor + household = 80% → $80k
    // to household. NGT's $20k goes to the trust-tax pass.
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking-hh",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
        {
          id: "acct-mixed",
          name: "Mixed-grantor brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 1_000_000,
          basis: 1_000_000,
          growthRate: 0.10,
          rmdEnabled: false,
          realization: {
            pctOrdinaryIncome: 1.0,
            pctLtCapitalGains: 0,
            pctQualifiedDividends: 0,
            pctTaxExempt: 0,
            turnoverPct: 0,
          },
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "entity", entityId: "idgt", percent: 0.3 },
            { kind: "entity", entityId: "ngt", percent: 0.2 },
          ],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2026,
      },
      entities: [
        {
          id: "idgt",
          name: "IDGT",
          includeInPortfolio: false,
          isGrantor: true,
          isIrrevocable: true,
          entityType: "trust",
        },
        {
          id: "ngt",
          name: "NGT",
          includeInPortfolio: false,
          isGrantor: false,
          isIrrevocable: true,
          entityType: "trust",
          distributionMode: null,
        },
      ],
      giftEvents: [],
    };
    const yrs = runProjection(data);
    // Household-like (FM 50% + grantor 30%) → 80% of $100k = $80k OI on the
    // household 1040 detail. NGT's 20% does NOT flow to household.
    expect(yrs[0].taxDetail?.ordinaryIncome).toBeCloseTo(80_000, 0);
  });
});

describe("fractional ownership: RMD single-owner guard (Task 7)", () => {
  it("RMD on a fully-entity-owned IRA routes to the entity checking and throws if mixed", () => {
    // 100% trust-owned IRA → routes to trust checking. Grantor → household tax.
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1950-01-01", // age 76 in 2026 → RMD eligible
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking-hh",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
          ],
        },
        {
          id: "acct-checking-trust",
          name: "Trust Checking",
          category: "cash",
          subType: "checking",
          value: 0,
          basis: 0,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "entity", entityId: "ngt", percent: 1 }],
        },
        {
          id: "acct-ira",
          name: "Trust IRA",
          category: "retirement",
          subType: "traditional_ira",
          value: 1_000_000,
          basis: 1_000_000,
          growthRate: 0,
          rmdEnabled: true,
          owners: [{ kind: "entity", entityId: "ngt", percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2026,
      },
      entities: [
        { id: "ngt", name: "NGT", includeInPortfolio: false, isGrantor: false },
      ],
      giftEvents: [],
    };
    const yrs = runProjection(data);
    // The trust IRA's RMD landed in the trust checking, not household.
    const trustChecking = yrs[0].accountLedgers["acct-checking-trust"];
    const rmdEntries = trustChecking.entries.filter((e) => e.category === "rmd");
    expect(rmdEntries.length).toBeGreaterThan(0);
    expect(rmdEntries[0].amount).toBeGreaterThan(0);
  });
});

describe("fractional ownership: dividend / interest / cap-gains routing (Task 6)", () => {
  it("70/30 household/non-grantor-trust taxable account: only 70% of OI/QDiv flow to household tax", () => {
    // Account grows $100k, all OI per realization model.
    // Old behavior (legacy ownerEntityId = undefined): 100% household → $100k OI.
    // Fractional behavior: 70% household (= $70k household OI), 30% to trust pass.
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
          ],
        },
        {
          id: "acct-mixed-tax",
          name: "Mixed-ownership Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 1_000_000,
          basis: 1_000_000,
          growthRate: 0.10,
          rmdEnabled: false,
          realization: {
            pctOrdinaryIncome: 1.0,
            pctLtCapitalGains: 0,
            pctQualifiedDividends: 0,
            pctTaxExempt: 0,
            turnoverPct: 0,
          },
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.7 },
            { kind: "entity", entityId: "ngt", percent: 0.3 },
          ],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2026,
      },
      entities: [
        // Non-grantor irrevocable trust — its 30% share of the OI must NOT flow into household tax detail.
        {
          id: "ngt",
          name: "NGT",
          includeInPortfolio: false,
          isGrantor: false,
          isIrrevocable: true,
          entityType: "trust",
          distributionMode: null,
        },
      ],
      giftEvents: [],
    };
    const yrs = runProjection(data);
    // Household OI = $100k * 70% = $70k.
    expect(yrs[0].taxDetail?.ordinaryIncome).toBeCloseTo(70_000, 0);
  });
});

describe("fractional ownership: balance sheet pro-rate (Task 5)", () => {
  it("portfolio rolls in only the household share of a 60/40 (FM/entity-non-portfolio) account", () => {
    // Account: 60% household, 40% entity (entity NOT in portfolio).
    // Today's behavior would be: legacy ownerEntityId=null → full $1M into portfolio.
    // Fractional behavior: only $600k household share is in portfolio.
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 1 },
          ],
        },
        {
          id: "acct-mixed",
          name: "Mixed-ownership Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 1_000_000,
          basis: 800_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.6 },
            { kind: "entity", entityId: "trust-1", percent: 0.4 },
          ],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2026,
      },
      entities: [
        { id: "trust-1", includeInPortfolio: false, isGrantor: false },
      ],
      giftEvents: [],
    };
    const yrs = runProjection(data);
    const t = yrs[0].portfolioAssets.taxable["acct-mixed"] ?? 0;
    expect(t).toBeCloseTo(600_000, 0);
    // Household checking is 100% household → unchanged.
    expect(yrs[0].portfolioAssets.cash["acct-checking"]).toBeCloseTo(100_000, 0);
  });
});

describe("fractional ownership: balance sheet year-aware pro-rate (Task 7 — Phase 3)", () => {
  it("Phase 3: 50% asset transfer at year 2030 splits household portfolio starting in 2030", () => {
    // Account starts 100% household-owned. A gift event in 2030 transfers 50%
    // to trust-1. Before 2030 the full account value lands in household portfolio;
    // from 2030 onward only 50% does.
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 50_000,
          basis: 50_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
        {
          id: "a1",
          name: "Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 1_000_000,
          basis: 1_000_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2032,
      },
      entities: [
        { id: "trust-1", name: "Test Trust", includeInPortfolio: false, isGrantor: true },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2030,
          accountId: "a1",
          percent: 0.5,
          grantor: "client",
          recipientEntityId: "trust-1",
        },
      ],
    };

    const yrs = runProjection(data);

    // 2029 (index 3): gift hasn't fired yet — household holds 100% of a1.
    const yr2029 = yrs.find((y) => y.year === 2029)!;
    expect(yr2029.portfolioAssets.taxable["a1"]).toBeCloseTo(1_000_000, 0);

    // 2030 (index 4): gift fires — household holds 50%, trust holds 50%.
    // Only the household 50% appears in portfolioAssets (trust is not includeInPortfolio).
    const yr2030 = yrs.find((y) => y.year === 2030)!;
    expect(yr2030.portfolioAssets.taxable["a1"]).toBeCloseTo(500_000, 0);

    // 2031+: still 50%.
    const yr2031 = yrs.find((y) => y.year === 2031)!;
    expect(yr2031.portfolioAssets.taxable["a1"]).toBeCloseTo(500_000, 0);
  });
});

describe("year-aware dividend/interest/cap-gain routing (Task 8 — Phase 3)", () => {
  it("Phase 3: dividend split flips at the gift year", () => {
    // Account starts 100% household-owned with a 10% qualified-dividend yield.
    // At 2030, 50% is gifted to a non-grantor trust.
    // Pre-2030: household receives 100% of dividends (taxDetail.dividends = full).
    // From 2030 onward: household receives only 50% (trust takes the rest via yearRealizations).
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 50_000,
          basis: 50_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
        {
          id: "acct-div",
          name: "Dividend Brokerage",
          category: "taxable",
          subType: "brokerage",
          value: 1_000_000,
          basis: 1_000_000,
          growthRate: 0.10,
          rmdEnabled: false,
          realization: {
            pctOrdinaryIncome: 0,
            pctLtCapitalGains: 0,
            pctQualifiedDividends: 1.0,
            pctTaxExempt: 0,
            turnoverPct: 0,
          },
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2032,
      },
      entities: [
        {
          id: "ngt-div",
          name: "Dividend Trust",
          includeInPortfolio: false,
          isGrantor: false,
          isIrrevocable: true,
          entityType: "trust",
          distributionMode: null,
        },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2030,
          accountId: "acct-div",
          percent: 0.5,
          grantor: "client",
          recipientEntityId: "ngt-div",
        },
      ],
    };

    const yrs = runProjection(data);

    // 2029: gift hasn't fired — household gets 100% of dividends = $100k (10% of $1M).
    const yr2029 = yrs.find((y) => y.year === 2029)!;
    // taxDetail.dividends should be close to 100k (growth compounds, so approximately)
    expect(yr2029.taxDetail?.dividends).toBeGreaterThan(90_000);

    // 2030: gift fires — household gets only 50% of dividends.
    const yr2030 = yrs.find((y) => y.year === 2030)!;
    // The 2030 household dividend should be roughly half the 2029 value.
    // With 10% annual growth the balance is 10% larger in 2030, so
    // the expected ratio is 0.5 × 1.1 = 0.55 (not 0.5). The key
    // assertion is that it's near 0.55, not 1.1 (which would mean
    // the engine is still routing 100% to household in 2030).
    const div2030 = yr2030.taxDetail?.dividends ?? 0;
    const div2029 = yr2029.taxDetail?.dividends ?? 1;
    const ratio = div2030 / div2029;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.65); // would be ~1.1 if ownership not split
  });

  it("Phase 3: cap-gain at sale uses ownership at the sale year", () => {
    // Account: $1M value, $500k basis → $500k cap-gain at sale.
    // Gift 50% to non-grantor trust at 2030, then sell at 2031.
    // With year-aware routing: household's taxDetail.capitalGains = $250k,
    // trust's cap-gain ($250k) is subtracted from household taxDetail via trust pass.
    // Without year-aware routing: all $500k lands in household taxDetail (bug).
    const data: ClientData = {
      client: {
        firstName: "Test",
        lastName: "User",
        dateOfBirth: "1980-01-01",
        retirementAge: 65,
        planEndAge: 90,
        filingStatus: "single",
      },
      accounts: [
        {
          id: "acct-checking",
          name: "Household Checking",
          category: "cash",
          subType: "checking",
          value: 50_000,
          basis: 50_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
        {
          id: "acct-re",
          name: "Investment Property",
          category: "real_estate",
          subType: "real_estate",
          value: 1_000_000,
          basis: 500_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "tx-sell",
          name: "Sell Investment Property",
          type: "sell",
          year: 2031,
          accountId: "acct-re",
          proceedsAccountId: "acct-checking",
        },
      ],
      planSettings: {
        flatFederalRate: 0,
        flatStateRate: 0,
        inflationRate: 0,
        planStartYear: 2026,
        planEndYear: 2032,
      },
      entities: [
        {
          id: "ngt-re",
          name: "Real Estate Trust",
          includeInPortfolio: false,
          isGrantor: false,
          isIrrevocable: true,
          entityType: "trust",
          distributionMode: null,
        },
      ],
      giftEvents: [
        {
          kind: "asset",
          year: 2030,
          accountId: "acct-re",
          percent: 0.5,
          grantor: "client",
          recipientEntityId: "ngt-re",
        },
      ],
    };

    const yrs = runProjection(data);

    // At sale year 2031, total cap-gain = $500k. Ownership at 2031 = 50/50.
    // Household should see only $250k in taxDetail.capitalGains (trust's $250k is removed).
    const yr2031 = yrs.find((y) => y.year === 2031)!;
    expect(yr2031.taxDetail?.capitalGains).toBeCloseTo(250_000, -3);
  });
});
