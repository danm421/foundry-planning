import { describe, it, expect } from "vitest";
import { buildAssumptionsData } from "../view-model";
import { estimateAssumptionsPageCount } from "../estimate-page-count";
import type { BuildAssumptionsInput } from "../types";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import { ASSUMPTIONS_OPTIONS_DEFAULT } from "../options-schema";

const YEARS = [
  { year: 2026, ages: { client: 60, spouse: 58 } },
  { year: 2055, ages: { client: 89, spouse: 87 } },
] as unknown as ProjectionYear[];

function clientData(): ClientData {
  return {
    client: { dateOfBirth: "1966-01-01", spouseDob: "1968-01-01", spouseName: "Jane" },
    accounts: [
      { id: "a1", name: "Joint Brokerage", category: "taxable", growthRate: 0.062, value: 500000 },
      { id: "a2", name: "Checking", category: "cash", growthRate: 0.02, value: 25000 },
    ],
    withdrawalStrategy: [
      { accountId: "a2", priorityOrder: 1, startYear: 2026, endYear: 2055 },
      { accountId: "a1", priorityOrder: 2, startYear: 2026, endYear: 2055 },
    ],
    planSettings: {
      flatFederalRate: 0.22, flatStateRate: 0.05, inflationRate: 0.03,
      planStartYear: 2026, planEndYear: 2055, taxEngineMode: "flat",
      residenceState: "CA", estateAdminExpenses: 20000, irdTaxRate: 0.37,
      probateCostRate: 0.02, marketShock: { year: 2030, drawdownPct: 0.3 },
    },
  } as unknown as ClientData;
}

function bundle(): InvestmentsBundle {
  return {
    accounts: [
      { id: "a1", name: "Joint Brokerage", category: "taxable", growthSource: "model_portfolio", modelPortfolioId: "mp-1", tickerPortfolioId: null, value: 500000, ownerEntityId: null, entityInPortfolio: false },
      { id: "a2", name: "Checking", category: "cash", growthSource: "inflation", modelPortfolioId: null, tickerPortfolioId: null, value: 25000, ownerEntityId: null, entityInPortfolio: false },
    ],
    assetClassLites: [
      { id: "eq", name: "US Equity", sortOrder: 1, assetType: "equity" },
      { id: "bd", name: "US Bonds", sortOrder: 2, assetType: "fixed_income" },
    ],
    assetClassData: [
      { id: "eq", arithmeticMean: 0.09, geometricReturn: 0.08, volatility: 0.16, pctOrdinaryIncome: 0, pctLtCapitalGains: 1, pctQualifiedDividends: 0, pctTaxExempt: 0 },
      { id: "bd", arithmeticMean: 0.04, geometricReturn: 0.038, volatility: 0.05, pctOrdinaryIncome: 1, pctLtCapitalGains: 0, pctQualifiedDividends: 0, pctTaxExempt: 0 },
    ],
    modelPortfolioAllocationsByPortfolioId: { "mp-1": [{ assetClassId: "eq", weight: 0.6 }, { assetClassId: "bd", weight: 0.4 }] },
    accountMixByAccountId: {},
    tickerPortfolioAllocationsByPortfolioId: {},
    portfolioLites: [{ id: "mp-1", name: "60/40 Growth" }],
    planGrowthDefaults: {
      taxable: { source: "model_portfolio", modelPortfolioId: "mp-1", customRate: 0.06 },
      cash: { source: "inflation", modelPortfolioId: null, customRate: 0.02 },
      retirement: { source: "model_portfolio", modelPortfolioId: "mp-1", customRate: 0.07 },
      realEstate: { source: "custom", modelPortfolioId: null, customRate: 0.03 },
      business: { source: "inflation", modelPortfolioId: null, customRate: 0.04 },
      lifeInsurance: { source: "custom", modelPortfolioId: null, customRate: 0.05 },
    },
  } as unknown as InvestmentsBundle;
}

function input(overrides: Partial<BuildAssumptionsInput> = {}): BuildAssumptionsInput {
  return {
    clientData: clientData(),
    years: YEARS,
    investments: bundle(),
    scenarioLabel: "Base Case",
    options: ASSUMPTIONS_OPTIONS_DEFAULT,
    ...overrides,
  };
}

describe("buildAssumptionsData", () => {
  it("builds horizon, income-tax, estate, and inflation overview sections", () => {
    const d = buildAssumptionsData(input());
    const headings = d.overviewSections.map((s) => s.heading);
    expect(headings).toEqual(["Plan Horizon", "Income Tax", "Estate Tax", "Inflation"]);
    const tax = d.overviewSections.find((s) => s.heading === "Income Tax")!;
    expect(tax.rows).toContainEqual({ label: "Method", value: "Flat rate" });
    expect(tax.rows).toContainEqual({ label: "Federal rate", value: "22.0%" });
  });

  it("emits six category-growth rows with blended model rate for model_portfolio", () => {
    const d = buildAssumptionsData(input());
    expect(d.categoryGrowth).toHaveLength(6);
    const taxable = d.categoryGrowth.find((r) => r.category === "Taxable")!;
    expect(taxable.source).toBe("Model: 60/40 Growth");
    expect(taxable.rate).toBe("6.3%"); // 0.6*0.08 + 0.4*0.038 = 0.0632
    const cash = d.categoryGrowth.find((r) => r.category === "Cash")!;
    expect(cash).toEqual({ category: "Cash", source: "Inflation", rate: "3.0%" });
    const re = d.categoryGrowth.find((r) => r.category === "Real Estate")!;
    expect(re).toEqual({ category: "Real Estate", source: "Custom", rate: "3.0%" });
  });

  it("labels asset-mix and ticker-portfolio category sources with rate em-dash", () => {
    const inv = bundle();
    inv.planGrowthDefaults = {
      ...inv.planGrowthDefaults!,
      taxable: { source: "asset_mix", modelPortfolioId: null, customRate: 0.06 },
      retirement: { source: "ticker_portfolio", modelPortfolioId: null, customRate: 0.07 },
    };
    const d = buildAssumptionsData(input({ investments: inv }));
    const taxable = d.categoryGrowth.find((r) => r.category === "Taxable")!;
    expect(taxable).toEqual({ category: "Taxable", source: "Asset mix", rate: "—" });
    const retirement = d.categoryGrowth.find((r) => r.category === "Retirement")!;
    expect(retirement).toEqual({ category: "Retirement", source: "Fund portfolio", rate: "—" });
  });

  it("resolves withdrawal order to account names by priority", () => {
    expect(buildAssumptionsData(input()).withdrawalOrder).toEqual(["Checking", "Joint Brokerage"]);
  });

  it("lists active stress tests only", () => {
    const d = buildAssumptionsData(input());
    expect(d.stressTests).toEqual([{ label: "Market shock", value: "30.0% drawdown in 2030" }]);
  });

  it("builds the per-account table with effective rate + source, sorted by category then name", () => {
    const rows = buildAssumptionsData(input()).accounts!;
    expect(rows).toHaveLength(2);
    // Sorted: Cash "Checking" before Taxable "Joint Brokerage".
    expect(rows[0]).toMatchObject({ name: "Checking", category: "Cash", rate: "2.0%", source: "Inflation", value: 25000 });
    expect(rows[1]).toMatchObject({ name: "Joint Brokerage", category: "Taxable", rate: "6.2%", source: "Model: 60/40 Growth", value: 500000 });
  });

  it("drops account values when showAccountValues is off", () => {
    const rows = buildAssumptionsData(input({ options: { ...ASSUMPTIONS_OPTIONS_DEFAULT, showAccountValues: false } })).accounts!;
    const brokerage = rows.find((r) => r.name === "Joint Brokerage")!;
    expect(brokerage).toMatchObject({ category: "Taxable", rate: "6.2%", source: "Model: 60/40 Growth", value: null });
  });

  it("builds referenced portfolios and the CMA table for the appendix", () => {
    const d = buildAssumptionsData(input());
    expect(d.referencedPortfolios).toHaveLength(1);
    expect(d.referencedPortfolios![0]).toMatchObject({ name: "60/40 Growth", blendedReturn: "6.3%" });
    expect(d.cma).toEqual([
      { assetClass: "US Equity", expectedReturn: "8.0%", volatility: "16.0%" },
      { assetClass: "US Bonds", expectedReturn: "3.8%", volatility: "5.0%" },
    ]);
    expect(d.showBaseCaseFootnote).toBe(true);
  });

  it("omits appendix + account sections when toggled off", () => {
    const d = buildAssumptionsData(input({ options: { includeAccountTable: false, includeCmaAppendix: false, showAccountValues: true } }));
    expect(d.accounts).toBeNull();
    expect(d.referencedPortfolios).toBeNull();
    expect(d.cma).toBeNull();
    expect(d.showBaseCaseFootnote).toBe(false);
  });

  it("degrades gracefully with no investments bundle", () => {
    const d = buildAssumptionsData(input({ investments: undefined }));
    expect(d.categoryGrowth).toEqual([]);
    expect(d.cma).toBeNull();
    expect(d.referencedPortfolios).toBeNull();
    // account table still renders from engine accounts, source unknown
    const brokerage = d.accounts!.find((r) => r.name === "Joint Brokerage")!;
    expect(brokerage).toMatchObject({ name: "Joint Brokerage", rate: "6.2%", source: "—" });
  });
});

describe("estimateAssumptionsPageCount", () => {
  it("counts overview + account pages + appendix", () => {
    const d = buildAssumptionsData(input());
    expect(estimateAssumptionsPageCount(d, ASSUMPTIONS_OPTIONS_DEFAULT)).toBe(3);
    const overviewOnly = buildAssumptionsData(input({ options: { includeAccountTable: false, includeCmaAppendix: false, showAccountValues: true } }));
    expect(estimateAssumptionsPageCount(overviewOnly, { includeAccountTable: false, includeCmaAppendix: false, showAccountValues: true })).toBe(1);
  });
});
