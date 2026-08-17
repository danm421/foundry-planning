/**
 * The "Other Inflows" line for a stock-option plan is NET equity cash, and it
 * is signed: an exercise-and-hold pays the strike out of pocket and receives
 * nothing, so the year reads negative. It used to be called "Equity Sale",
 * which named a transaction that had not happened — carried over from G4.
 *
 * The test drives the REAL projection so the negative year is produced rather
 * than asserted into existence.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import { buildNameMaps } from "../cashflow-year-detail";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { TAX_YEAR_2026 } from "@/engine/__tests__/_fixtures/tax-year-2026";
import type { Account, ClientData, ClientInfo, FamilyMember, PlanSettings } from "@/engine/types";
import type { StockOptionPlan } from "@/engine/equity/types";

const PSY = 2026;

const CLIENT: ClientInfo = {
  firstName: "Equity", lastName: "Holder", dateOfBirth: "1980-01-01",
  retirementAge: 65, planEndAge: 60, filingStatus: "single",
};
const FM: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Equity", lastName: "Holder", dateOfBirth: "1980-01-01",
};
const SETTINGS: PlanSettings = {
  flatFederalRate: 0.24, flatStateRate: 0.05, inflationRate: 0,
  planStartYear: PSY, planEndYear: 2040, taxEngineMode: "bracket", taxInflationRate: 0,
};
const OWNERS = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];
const CHECKING: Account = {
  id: "chk", name: "Checking", category: "cash", subType: "checking", titlingType: "jtwros",
  value: 500_000, basis: 500_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true, owners: OWNERS,
};
const SO: Account = {
  id: "iso", name: "ACME Equity", category: "stock_options", subType: "stock_options",
  titlingType: "jtwros", value: 0, basis: 0, growthRate: 0.05, rmdEnabled: false, owners: OWNERS,
};

// ISO exercised at vest in 2029 and HELD: 1,000 shares × $25 strike out, $0 in.
const EXERCISE_AND_HOLD: StockOptionPlan = {
  accountId: "iso", ticker: "ACME", pricePerShare: 100, growthRate: 0.05,
  destinationAccountId: null, autoCreateDestination: true, sellToCover: false, withholdingRate: 0.22,
  strategy: {
    exerciseTiming: "at_vest", exerciseYear: null, sellTiming: "hold",
    sellYear: null, sellPercentPerYear: null, sellStartYear: null,
  },
  owner: "client",
  grants: [{
    id: "g", grantNumber: "ISO-1", grantType: "iso", grantDate: "2024-01-15", sharesGranted: 1000,
    has83bElection: false, fmvAtGrant: null, strikePrice: 25, strikeDiscountPct: null,
    expirationYear: 2034, strategy: null,
    // Nothing exercised, so there is no pre-plan acquisition to record.
    tranches: [{ id: "t", vestDate: "2029-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0,
      acquiredOn: null, priceAtAcquisition: null, strategy: null }],
    plannedEvents: [],
  }],
};

const DATA: ClientData = {
  client: CLIENT, accounts: [CHECKING, SO], incomes: [], expenses: [], liabilities: [],
  savingsRules: [], withdrawalStrategy: [], planSettings: SETTINGS, familyMembers: [FM],
  giftEvents: [], taxYearRows: [TAX_YEAR_2026], stockOptionPlans: [EXERCISE_AND_HOLD],
};

describe("the Other Inflows label for equity cash", () => {
  it("does not call a strike payment a sale", () => {
    const key = `equity-proceeds:${EXERCISE_AND_HOLD.accountId}`;
    const year = runProjection(DATA).find((y) => (y.income.bySource[key] ?? 0) !== 0);

    // The premise: the plan really does publish a NEGATIVE figure here.
    expect(year?.year).toBe(2029);
    expect(year!.income.bySource[key]).toBeCloseTo(-25_000, 2); // 1,000 × $25 strike

    const label = buildNameMaps(DATA).otherInflowNames[key];
    expect(label).toBe("Equity Net Cash: ACME");
    expect(label).not.toMatch(/sale/i);
  });
});
