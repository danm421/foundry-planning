import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildGrantTimeline } from "../equity/timeline";
import { resolveStrategy } from "../equity/strategy";
import { LEGACY_FM_CLIENT } from "../ownership";
import type {
  Account, AssetTransaction, ClientData, ClientInfo, FamilyMember, PlanSettings, Reinvestment,
} from "../types";
import type { EquityGrant, StockOptionPlan } from "../equity/types";

// "Start the plan next year": a sale, purchase, reinvestment or option exercise
// dated in the skipped year already happened. Its lasting effect is in place
// at the start; its cash, tax and gain are assumed already in today's balances.

const client: ClientInfo = {
  firstName: "Ada", lastName: "Byron", dateOfBirth: "1970-01-01",
  retirementAge: 65, planEndAge: 95, filingStatus: "single",
};
const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Ada", lastName: "Byron", dateOfBirth: "1970-01-01",
};
const owned = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];

const skipped: PlanSettings = {
  flatFederalRate: 0.2, flatStateRate: 0, inflationRate: 0, taxInflationRate: 0,
  planStartYear: 2027, planEndYear: 2030, dataYear: 2026,
};
const noSkip: PlanSettings = { ...skipped, dataYear: 2027 };

const checking: Account = {
  id: "checking", name: "Checking", category: "cash", subType: "checking", titlingType: "jtwros",
  value: 100_000, basis: 100_000, growthRate: 0, rmdEnabled: false, isDefaultChecking: true, owners: owned,
};
const brokerage: Account = {
  id: "brok", name: "Brokerage", category: "taxable", subType: "brokerage", titlingType: "jtwros",
  value: 200_000, basis: 100_000, growthRate: 0, rmdEnabled: false, owners: owned,
};

function run(planSettings: PlanSettings, over: Partial<ClientData>) {
  return runProjection({
    client, accounts: [checking, brokerage], incomes: [], expenses: [], liabilities: [],
    savingsRules: [], withdrawalStrategy: [], planSettings, familyMembers: [clientFm], giftEvents: [],
    ...over,
  } as ClientData);
}

const sale = (year: number): AssetTransaction => ({ id: "s1", name: "Sell brokerage", type: "sell", year, accountId: "brok" });
const purchase = (year: number): AssetTransaction => ({
  id: "p1", name: "Buy cabin", type: "buy", year, assetName: "Cabin", assetCategory: "real_estate",
  assetSubType: "vacation_home", purchasePrice: 300_000, growthRate: 0, fundingAccountId: "checking",
});
const reinvestment = (year: number): Reinvestment => ({
  id: "r1", name: "Switch to equities", accountIds: ["brok"], year, newGrowthRate: 0.08,
  realizeTaxesOnSwitch: true, soldFractionByAccount: { brok: 1 },
} as Reinvestment);

describe("asset transactions dated in the skipped year", () => {
  it("a full sale dated this year leaves the asset gone at the start", () => {
    const [y] = run(skipped, { assetTransactions: [sale(2026)] });
    expect(y.year).toBe(2027);
    expect(y.accountLedgers["brok"]).toBeUndefined();
    expect(y.taxDetail!.capitalGains).toBe(0);
    expect(y.accountLedgers["checking"].endingValue).toBeCloseTo(100_000, 0);
  });

  it("a purchase dated this year is held at the start", () => {
    const [y] = run(skipped, { assetTransactions: [purchase(2026)] });
    expect(y.accountLedgers["technique-acct-p1"].beginningValue).toBeCloseTo(300_000, 0);
    expect(y.accountLedgers["technique-acct-p1"].contributions).toBe(0);
    expect(y.accountLedgers["checking"].endingValue).toBeCloseTo(100_000, 0);
  });

  it("a reinvestment dated this year applies from the start", () => {
    const [y] = run(skipped, { reinvestments: [reinvestment(2026)] });
    expect(y.accountLedgers["brok"].growth).toBeCloseTo(200_000 * 0.08, 0);
    expect(y.taxDetail!.capitalGains).toBe(0);
  });

  it("with no skipped year every one of these behaves as today", () => {
    const [sold] = run(noSkip, { assetTransactions: [sale(2027)] });
    expect(sold.accountLedgers["brok"]?.endingValue ?? 0).toBe(0);
    expect(sold.taxDetail!.capitalGains).toBeCloseTo(100_000, 0);

    const [bought] = run(noSkip, { assetTransactions: [purchase(2027)] });
    expect(bought.accountLedgers["technique-acct-p1"].contributions).toBeCloseTo(300_000, 0);

    const [switched] = run(noSkip, { reinvestments: [reinvestment(2027)] });
    expect(switched.taxDetail!.capitalGains).toBeCloseTo(100_000, 0);
  });
});

// ── Stock options ──────────────────────────────────────────────────────────

const PRICE = 100;
const nso = (plannedSell?: { year: number; shares: number }): EquityGrant => ({
  id: "g-nso", grantNumber: "NSO-1", grantType: "nqso", grantDate: "2024-03-01", sharesGranted: 1_000,
  has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null, expirationYear: 2034,
  strategy: null,
  tranches: [{
    id: "t1", vestDate: "2026-03-01", shares: 1_000, sharesExercised: 0, sharesSold: 0,
    acquiredOn: null, priceAtAcquisition: null, strategy: null,
  }],
  plannedEvents: plannedSell ? [{ year: plannedSell.year, action: "sell", shares: plannedSell.shares }] : [],
} as EquityGrant);
const atVestHold = resolveStrategy({
  exerciseTiming: "at_vest", exerciseYear: null, sellTiming: "hold", sellYear: null,
  sellPercentPerYear: null, sellStartYear: null,
}, null, null);
const fmvAt = (year: number) => PRICE * 1.1 ** (year - 2027);

function equityPlan(grant: EquityGrant): StockOptionPlan {
  return {
    accountId: "so", ticker: "ACME", pricePerShare: PRICE, growthRate: 0.1, destinationAccountId: null,
    autoCreateDestination: true, sellToCover: false, withholdingRate: 0,
    strategy: { exerciseTiming: "at_vest", exerciseYear: null, sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null },
    owner: "client", grants: [grant],
  } as StockOptionPlan;
}
const soAccount: Account = {
  id: "so", name: "ACME", category: "stock_options", subType: "stock_options", titlingType: "jtwros",
  value: 0, basis: 0, growthRate: 0.1, rmdEnabled: false, owners: owned,
};

describe("an option exercise dated in the skipped year", () => {
  it("an option exercise planned this year is already done", () => {
    const actions = buildGrantTimeline(nso(), atVestHold, 2027, fmvAt, 2026);
    expect(actions.some((a) => a.kind === "exercise")).toBe(false);
    const held = actions.filter((a) => a.kind === "seed_held");
    expect(held.map((a) => [a.year, a.shares])).toEqual([[2027, 1_000]]);
    expect(held[0].date).toBe("2026-03-01");

    // Today, the same exercise is pushed into the first plan year.
    expect(buildGrantTimeline(nso(), atVestHold, 2027, fmvAt).some((a) => a.kind === "exercise" && a.year === 2027)).toBe(true);

    const [y] = run(skipped, { accounts: [checking, soAccount], stockOptionPlans: [equityPlan(nso())] });
    expect(y.equityTaxImpact).toBeUndefined();
    expect(y.accountLedgers["equity-dest-so"]?.endingValue ?? 0).toBeGreaterThan(0);
  });

  it("a planned sell dated this year books no first-year sale", () => {
    const actions = buildGrantTimeline(nso({ year: 2026, shares: 400 }), atVestHold, 2027, fmvAt, 2026);
    expect(actions.filter((a) => a.kind === "sell")).toEqual([]);
    expect(actions.filter((a) => a.kind === "seed_held").map((a) => a.shares)).toEqual([600]);
  });
});
