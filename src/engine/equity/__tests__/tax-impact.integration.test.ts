import { describe, it, expect } from "vitest";
import { runProjection } from "../../projection";
import type {
  Account, ClientData, ClientInfo, PlanSettings, FamilyMember, Income,
} from "../../types";
import type { StockOptionPlan } from "../types";
import type { TaxYearParameters } from "../../../lib/tax/types";
import { LEGACY_FM_CLIENT } from "../../ownership";
import { TAX_YEAR_2026 } from "../../__tests__/_fixtures/tax-year-2026";

const PLAN_START = 2026;
const PRICE = 420;

const CLIENT: ClientInfo = {
  firstName: "Equity", lastName: "Holder", dateOfBirth: "1980-01-01",
  retirementAge: 65, planEndAge: 90, filingStatus: "single",
};
const FM_CLIENT: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Equity", lastName: "Holder", dateOfBirth: "1980-01-01",
};
const PLAN_SETTINGS: PlanSettings = {
  flatFederalRate: 0.24, flatStateRate: 0.05, inflationRate: 0,
  planStartYear: PLAN_START, planEndYear: 2035,
  taxEngineMode: "bracket", taxInflationRate: 0,
};
const CHECKING: Account = {
  id: "checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 250_000, basis: 250_000, growthRate: 0,
  rmdEnabled: false, isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};
const SO_ACCOUNT: Account = {
  id: "so-equity", name: "ACME Equity", category: "stock_options", subType: "stock_options",
  titlingType: "jtwros", value: 0, basis: 0, growthRate: 0.07, rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

// RSU plan: one tranche vesting 2027, HOLD (no sell-to-cover) so NO shares sell
// in the vest year → equity capital gains == 0, ordinary income only.
const RSU_HOLD: StockOptionPlan = {
  accountId: "so-equity", ticker: "ACME", pricePerShare: PRICE, growthRate: 0.07,
  destinationAccountId: null, autoCreateDestination: true,
  sellToCover: false, withholdingRate: 0,
  strategy: { exerciseTiming: "at_vest", exerciseYear: null, sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null },
  owner: "client",
  grants: [{
    id: "g-rsu", grantNumber: "RSU-1", grantType: "rsu", grantYear: 2025,
    sharesGranted: 200, has83bElection: false, fmvAtGrant: null, strikePrice: null,
    strikeDiscountPct: null, expirationYear: null,
    strategy: { sellTiming: "hold", sellYear: null },
    tranches: [{ id: "t-2027", vestYear: 2027, shares: 200, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [],
  }],
};

// Other long-term capital gains in 2027 — alone sits in the 0% LTCG bracket
// for a single filer (≈ $40k taxable < the 0% ceiling). Options ordinary income
// (200 × ≈$449 ≈ $90k) pushes this into the 15% tier.
const OTHER_LTCG_2027: Income = {
  id: "ltcg", type: "capital_gains", name: "Brokerage gain", annualAmount: 40_000,
  startYear: 2027, endYear: 2027, growthRate: 0, owner: "client",
};

function buildData(over?: Partial<ClientData>): ClientData {
  return {
    client: CLIENT, accounts: [CHECKING, SO_ACCOUNT], incomes: [], expenses: [],
    liabilities: [], savingsRules: [], withdrawalStrategy: [], planSettings: PLAN_SETTINGS,
    familyMembers: [FM_CLIENT], giftEvents: [], taxYearRows: [TAX_YEAR_2026 as TaxYearParameters],
    ...over,
  };
}

describe("equityTaxImpact — projection counterfactual", () => {
  it("populates the field in the vest year with payroll + federal tax, zero cap-gains", () => {
    const byYear = new Map(runProjection(buildData({ stockOptionPlans: [RSU_HOLD] })).map((y) => [y.year, y]));
    const e = byYear.get(2027)!.equityTaxImpact;
    expect(e).toBeDefined();
    expect(e!.ordinaryIncome).toBeGreaterThan(0);
    expect(e!.payrollTax).toBeGreaterThan(0);   // RSU vest is FICA-bearing W-2 wages
    expect(e!.fedIncomeTax).toBeGreaterThan(0);
    expect(e!.capitalGains).toBe(0);            // nothing sold this year
    // totalTax is the sum of the four columns
    expect(e!.totalTax).toBeCloseTo(e!.fedIncomeTax + e!.capGainsTax + e!.payrollTax + e!.stateTax, 6);
  });

  it("leaves equityTaxImpact undefined in years with no equity activity (guard)", () => {
    const byYear = new Map(runProjection(buildData({ stockOptionPlans: [RSU_HOLD] })).map((y) => [y.year, y]));
    expect(byYear.get(2026)!.equityTaxImpact).toBeUndefined();
  });

  it("captures the bracket-push: positive cap-gains tax with zero options gains", () => {
    const byYear = new Map(
      runProjection(buildData({ stockOptionPlans: [RSU_HOLD], incomes: [OTHER_LTCG_2027] })).map((y) => [y.year, y]),
    );
    const e = byYear.get(2027)!.equityTaxImpact!;
    // The options themselves realized no capital gain this year ...
    expect(e.capitalGains).toBe(0);
    // ... yet the additional ordinary income pushed the client's $40k of OTHER
    // LTCG out of the 0% tier, so there IS an additional capital-gains tax.
    expect(e.capGainsTax).toBeGreaterThan(0);
  });
});
