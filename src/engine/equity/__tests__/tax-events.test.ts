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
    // Lots are keyed by acquisition event now, not by vesting row: `#ex` is the
    // lot this in-plan exercise created.
    const lot = st.lots.get("g4:t1#ex")!;
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

describe("FICA-exempt equity income (IRC §3121(a)(22))", () => {
  // Three kinds of equity ordinary income share one bucket, but only two are
  // payroll wages. Income from a disqualifying disposition of ISO stock is
  // fully taxable W-2 box 1 income that §3121(a)(22) excludes from FICA — so it
  // has to be reported as a subset of ordinaryIncome, not removed from it.
  const isoGrant: EquityGrant = {
    id: "g-dq", grantNumber: "ISO-DQ", grantType: "iso", grantYear: 2026, sharesGranted: 10_000,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2036, plannedEvents: [],
    strategy: { exerciseTiming: "at_vest", sellTiming: "immediately" },
    tranches: [{ id: "t1", vestYear: 2027, shares: 10_000, sharesExercised: 0, sharesSold: 0, strategy: null }],
  };

  it("flags a disqualifying ISO disposition as exempt without taking it out of ordinary income", () => {
    // Cashless exercise-and-sell at $100 on a $10 strike: the whole $900,000
    // bargain element is ordinary income, and none of it is FICA wages.
    const p = plan(isoGrant);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBeCloseTo(900_000, 2);
    expect(r.ficaExemptOrdinaryIncome).toBeCloseTo(900_000, 2);
  });

  it("leaves an RSU vest fully FICA-bearing", () => {
    const p = plan(rsuFutureVest);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBeCloseTo(10_000, 2);
    expect(r.ficaExemptOrdinaryIncome).toBe(0);
  });

  it("leaves an NQSO exercise spread fully FICA-bearing", () => {
    const g: EquityGrant = { ...rsuFutureVest, id: "g-nq", grantType: "nqso", strikePrice: 10,
      tranches: [{ id: "t1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBeCloseTo(9_000, 2);
    expect(r.ficaExemptOrdinaryIncome).toBe(0);
  });
});

describe("a vesting row holding two lots at once", () => {
  // 1,000 NQSO at a $10 strike, 400 already exercised and held before the plan.
  // The plan exercises the other 600 in 2030 and sells everything in 2033.
  // Both lots hung off the same ledger key, so the 2030 exercise overwrote the
  // seeded 400 and the sale could only find 600 shares to sell.
  const splitRow: EquityGrant = {
    id: "g-split", grantNumber: "NQ-SPLIT", grantType: "nqso", grantYear: 2024, sharesGranted: 1000,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2034, plannedEvents: [],
    strategy: { exerciseTiming: "specific_year", exerciseYear: 2030, sellTiming: "hold_then_sell_year", sellYear: 2033 },
    tranches: [{ id: "t1", vestYear: 2025, shares: 1000, sharesExercised: 400, sharesSold: 0, strategy: null }],
  };

  it("sells all 1,000 shares, not just the lot that survived the overwrite", () => {
    const p = plan(splitRow); // pricePerShare 100, growthRate 0
    const st = createEquityState([p], PSY);
    let proceeds = 0;
    let strikeOut = 0;
    for (let y = PSY; y <= 2035; y++) {
      const r = computeEquityYear(p, st, y);
      proceeds += r.sellProceeds;
      strikeOut += r.strikeCashOutflow;
    }
    expect(proceeds).toBeCloseTo(1000 * 100, 2); // 100,000 — was 60,000
    expect(strikeOut).toBeCloseTo(600 * 10, 2);  // 6,000 for the 600 exercised
    expect(proceeds - strikeOut).toBeCloseTo(94_000, 2); // lifetime cash; was 54,000
  });
});

describe("options the plan must not exercise", () => {
  it("books no income and no cash for an option that lapsed before the plan", () => {
    const g: EquityGrant = {
      id: "g-lapsed", grantNumber: "NQ-OLD", grantType: "nqso", grantYear: 2018, sharesGranted: 5000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2025, strategy: null, plannedEvents: [],
      tranches: [{ id: "t1", vestYear: 2020, shares: 5000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, PSY);
    expect(r.ordinaryIncome).toBe(0);      // was 450,000 of phantom W-2 income
    expect(r.strikeCashOutflow).toBe(0);   // was 50,000 of cash spent
  });

  it("books no cash for an option that is under water at its exercise year", () => {
    const g: EquityGrant = {
      id: "g-uw", grantNumber: "NQ-UW", grantType: "nqso", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 100, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null, plannedEvents: [],
      tranches: [{ id: "t1", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    };
    const p = plan(g, { pricePerShare: 50 }); // $50 share against a $100 strike
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.strikeCashOutflow).toBe(0);   // was 100,000 spent to buy 50,000 of stock
    expect(r.acquisitions).toHaveLength(0);
  });
});
