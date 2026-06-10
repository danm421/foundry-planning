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
  // Exercise in 2027 @ strike 10, fmvAtExercise 100, 100 shares, then drive the sale price by
  // overriding lot fields + plan.pricePerShare so the exact f-per-share is deterministic.
  function exerciseAndPrep(grantOver: Partial<EquityGrant>, sellYear: number) {
    const g: EquityGrant = { ...rsuFutureVest, id: "g4", grantType: "iso", strikePrice: 10, expirationYear: 2034,
      grantYear: 2024,
      strategy: { sellTiming: "hold_then_sell_year", sellYear },
      tranches: [{ id: "t1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }],
      ...grantOver };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    computeEquityYear(p, st, 2027); // exercise → seeds the lot
    const lot = st.lots.get("g4:t1")!;
    lot.fmvAtExercise = 100; lot.strike = 10; lot.basisPerShare = 10; lot.exerciseYear = 2027;
    return { p, st };
  }

  it("converts the bargain element to ordinary income when sold too early (price flat)", () => {
    // sell 2028 (1yr from exercise → disqualifying), f = 100 (flat). OI = full spread 9,000.
    const { p, st } = exerciseAndPrep({}, 2028);
    p.pricePerShare = 100; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2028);
    expect(r.ordinaryIncome).toBeCloseTo(9000, 2);
  });

  it("caps OI at the actual sale gain and books NO cap gain/loss when price falls but stays above strike", () => {
    // grant 2027 so 2029 sale fails the 3yr-from-grant test (disqualifying) but passes the
    // 2yr-from-exercise proxy → long-term residual. f = 60.
    // OI = lesser(spread 90, sale gain 50) = 50/sh → 5,000. residual = 0.
    const { p, st } = exerciseAndPrep({ grantYear: 2027 }, 2029);
    p.pricePerShare = 60; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2029);
    expect(r.ordinaryIncome).toBeCloseTo(5000, 2);
    expect(r.capitalGains).toBeCloseTo(0, 2);
    expect(r.stCapitalGains).toBeCloseTo(0, 2);
  });

  it("books a capital loss and zero OI when sold below strike", () => {
    // grant 2027, sell 2029 (disqualifying, long-term residual). f = 5 (below strike).
    // OI = lesser(spread 90, max(0, 5−10)=0) = 0. residual = (5−10)×100 = −500 long-term loss.
    const { p, st } = exerciseAndPrep({ grantYear: 2027 }, 2029);
    p.pricePerShare = 5; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2029);
    expect(r.ordinaryIncome).toBeCloseTo(0, 2);
    expect(r.capitalGains).toBeCloseTo(-500, 2); // 2029−2027 ≥2yr → long-term
    expect(r.stCapitalGains).toBeCloseTo(0, 2);
  });

  it("routes the post-exercise gain to SHORT-TERM when the disqualifying sale is within a year of exercise", () => {
    // sell 2028 (1yr from exercise → disqualifying AND short-term). f = 150.
    // OI = full spread 90/sh → 9,000. residual = (150−10−90)×100 = 5,000 → SHORT-TERM.
    const { p, st } = exerciseAndPrep({}, 2028);
    p.pricePerShare = 150; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2028);
    expect(r.ordinaryIncome).toBeCloseTo(9000, 2);
    expect(r.stCapitalGains).toBeCloseTo(5000, 2); // held <2yr → short-term
    expect(r.capitalGains).toBeCloseTo(0, 2);
  });
});
