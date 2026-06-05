import { describe, it, expect } from "vitest";
import { createEquityState, computeEquityYear } from "../tax-events";
import type { StockOptionPlan, EquityGrant } from "../types";

const PSY = 2026;

function plan(grant: EquityGrant, over: Partial<StockOptionPlan> = {}): StockOptionPlan {
  return {
    accountId: "so-1", ticker: "ACME", pricePerShare: 100, growthRate: 0,
    destinationAccountId: null, autoCreateDestination: true,
    sellToCover: false, withholdingRate: 0.22,
    strategy: { exerciseTiming: "at_vest", exerciseYear: null, sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null },
    owner: "client", grants: [grant], ...over,
  };
}

const rsuFutureVest: EquityGrant = {
  id: "g1", grantNumber: "RS-1", grantType: "rsu", grantYear: 2024, sharesGranted: 100,
  has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
  expirationYear: null, strategy: null,
  tranches: [{ id: "t1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }],
  plannedEvents: [],
};

describe("RSU vest", () => {
  it("books ordinary income = shares × FMV at the vest year and seeds a held lot", () => {
    const p = plan(rsuFutureVest); // growthRate 0 → FMV stays 100
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBe(100 * 100);
    expect(r.acquisitions[0]).toMatchObject({ value: 10000, basis: 10000 });
  });

  it("sell-to-cover sheds withholding shares at acquisition (≈no gain)", () => {
    const p = plan(rsuFutureVest, { sellToCover: true, withholdingRate: 0.25 });
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    // withhold $2,500 of $10,000 income → 25 shares @ $100
    expect(r.sellToCoverProceeds).toBeCloseTo(2500, 2);
    expect(r.acquisitions[0].value).toBeCloseTo(7500, 2); // 75 shares retained
  });
});

describe("NQSO exercise", () => {
  it("books spread as ordinary income and pays the strike as cash outflow", () => {
    const g: EquityGrant = { ...rsuFutureVest, id: "g2", grantType: "nqso", strikePrice: 10,
      tranches: [{ id: "t1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBe(100 * (100 - 10)); // 9,000 spread
    expect(r.strikeCashOutflow).toBe(100 * 10);       // 1,000
    expect(r.isoSpread).toBe(0);
  });
});

describe("ISO exercise + AMT", () => {
  it("routes the spread to isoSpread (not ordinary income) and sets regular basis = strike", () => {
    const g: EquityGrant = { ...rsuFutureVest, id: "g3", grantType: "iso", strikePrice: 10, grantYear: 2024, expirationYear: 2034,
      tranches: [{ id: "t1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBe(0);
    expect(r.isoSpread).toBe(100 * (100 - 10)); // 9,000 AMT preference
    expect(r.acquisitions[0].basis).toBe(100 * 10); // regular basis = strike
  });
});

describe("ISO disqualifying disposition", () => {
  it("converts the bargain element to ordinary income when sold too early", () => {
    // exercise 2027 @ strike 10, FMV 100; sell 2028 (held <2yr from exercise → disqualifying)
    const g: EquityGrant = { ...rsuFutureVest, id: "g4", grantType: "iso", strikePrice: 10, grantYear: 2024, expirationYear: 2034,
      strategy: { sellTiming: "hold_then_sell_year", sellYear: 2028 },
      tranches: [{ id: "t1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    computeEquityYear(p, st, 2027);            // exercise
    const r = computeEquityYear(p, st, 2028);  // disqualifying sale
    // bargain element at exercise = 100×(100−10)=9,000 → ordinary income
    expect(r.ordinaryIncome).toBeCloseTo(9000, 2);
  });
});
