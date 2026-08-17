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
  id: "g1", grantNumber: "RS-1", grantType: "rsu", grantDate: "2024-01-15", sharesGranted: 100,
  has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
  expirationYear: null, strategy: null,
  tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }],
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
      tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] };
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
    const g: EquityGrant = { ...rsuFutureVest, id: "g3", grantType: "iso", strikePrice: 10, grantDate: "2024-01-15", expirationYear: 2034,
      tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBe(0);
    expect(r.isoSpread).toBe(100 * (100 - 10)); // 9,000 AMT preference
    expect(r.acquisitions[0].basis).toBe(100 * 10); // regular basis = strike
  });
});

describe("ISO disqualifying disposition", () => {
  // Which side of each line a sale falls on is decided by `holding-period.ts` on
  // REAL DATES (G8). Two consequences drive every fixture below, and both are
  // worth stating because they changed the shape of these tests:
  //
  //   1. An in-plan exercise happens on the VEST DATE (15 Jan 2027 here), and a
  //      modeled sale happens on 31 DECEMBER of its year. So a sale in the year
  //      AFTER the exercise is ~23 months — comfortably long-term. The only way
  //      to model a short-term disposition is a SAME-YEAR sale. The predecessor's
  //      whole-year rule called a 2028 sale short-term; that was the F26/F27
  //      defect, not a property worth preserving.
  //   2. The two §422(a)(1) legs are now independent in practice: moving the
  //      GRANT date alone flips qualifying ↔ disqualifying while the residual
  //      stays long-term, which is what makes the lesser-of formula testable
  //      without also collapsing the capital-gain character.
  //
  // Exercise in 2027 @ strike 10, fmvAtExercise 100, 100 shares; the sale price
  // is driven by overriding lot fields + plan.pricePerShare so f is deterministic.
  function exerciseAndPrep(grantOver: Partial<EquityGrant>, sellYear: number) {
    const g: EquityGrant = { ...rsuFutureVest, id: "g4", grantType: "iso", strikePrice: 10, expirationYear: 2034,
      grantDate: "2024-01-15",
      strategy: { sellTiming: "hold_then_sell_year", sellYear },
      tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }],
      ...grantOver };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    computeEquityYear(p, st, 2027); // exercise → seeds the lot
    // Lots are keyed by acquisition event now, not by vesting row: `#ex` is the
    // lot this in-plan exercise created.
    const lot = st.lots.get("g4:t1#ex")!;
    lot.fmvAtExercise = 100; lot.strike = 10; lot.basisPerShare = 10; lot.amtBasisPerShare = 100;
    lot.exerciseDate = "2027-01-15"; lot.acquisitionDate = "2027-01-15";
    return { p, st };
  }

  it("converts the bargain element to ordinary income when sold too early (price flat)", () => {
    // Sell 31 Dec 2027 — 11.5 months from exercise, so the exercise leg fails and
    // the disposition is disqualifying. f = 100 (flat). OI = full spread 9,000.
    const { p, st } = exerciseAndPrep({}, 2027);
    p.pricePerShare = 100; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2027);
    expect(r.ordinaryIncome).toBeCloseTo(9000, 2);
    expect(r.ficaExemptOrdinaryIncome).toBeCloseTo(9000, 2); // §3121(a)(22)
  });

  it("caps OI at the actual sale gain and books NO cap gain/loss when price falls but stays above strike", () => {
    // Grant 2027 so the 2029 sale fails the GRANT leg (disqualifying) while
    // clearing the exercise leg → long-term residual. f = 60.
    // OI = lesser(spread 90, sale gain 50) = 50/sh → 5,000. residual = 0.
    //
    // ⚠️ The two zero assertions below are zero BY CONSTRUCTION and cannot fail —
    // that is audit F51. They stay because a zero residual is real behaviour
    // worth pinning, but the two cases that follow are what actually exercise
    // the long/short flag.
    const { p, st } = exerciseAndPrep({ grantDate: "2028-06-01" }, 2029);
    p.pricePerShare = 60; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2029);
    expect(r.ordinaryIncome).toBeCloseTo(5000, 2);
    expect(r.capitalGains).toBeCloseTo(0, 2);
    expect(r.stCapitalGains).toBeCloseTo(0, 2);
  });

  it("routes a REAL residual to LONG-TERM when the sale clears one year from exercise (F51)", () => {
    // Grant 1 Jun 2027 → the 31 Dec 2029 sale is 2.5y from grant... which CLEARS
    // the two-year leg. Use 1 Jun 2028 instead so the grant leg genuinely fails
    // (2028+2 = 2030 > 2029) while the exercise leg clears → disqualifying with a
    // long-term residual. f = 180.
    // OI = lesser(spread 90, gain 170) = 90/sh → 9,000.
    // residual = (180 − 10 − 90) × 100 = 8,000 → LONG-TERM. Non-zero, so the flag
    // is observable: this is the assertion F51 said did not exist.
    const { p, st } = exerciseAndPrep({ grantDate: "2028-06-01" }, 2029);
    p.pricePerShare = 180; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2029);
    expect(r.ordinaryIncome).toBeCloseTo(9000, 2);
    expect(r.capitalGains).toBeCloseTo(8000, 2);
    expect(r.stCapitalGains).toBeCloseTo(0, 2);
  });

  it("routes the SAME residual to SHORT-TERM when the sale is inside a year of exercise (F51 mirror)", () => {
    // Same $8,000 residual, opposite bucket. Together with the case above this
    // is the mutation-proof the old assertion could never give: sending every
    // residual to `capitalGains` breaks exactly one of the two.
    //
    // It has to be a PRE-PLAN lot, and that is a fact about the model rather
    // than a convenience. An in-plan exercise and an in-plan sale in the same
    // year read the same `fmv(year)`, so the bargain element and the sale gain
    // are identical and the residual is ZERO by construction; a sale in any
    // later year is >1y from a January exercise and therefore long-term. A
    // short-term residual is only reachable when the acquisition carries a REAL
    // stored date — exactly what G8 added.
    //
    // ISO granted 15 Jan 2024, exercised 1 Feb 2026 at $100 with a $10 strike,
    // sold 31 Dec 2026 at $180. Grant leg clears (2026-12-31 > 2026-01-15);
    // exercise leg fails (2026-12-31 < 2027-02-01) → disqualifying, and the
    // 11-month hold is short-term.
    // OI = lesser(bargain 90, gain 170) = 90/sh → 9,000.
    // residual = (180 − 10 − 90) × 100 = 8,000 → SHORT-TERM.
    const g: EquityGrant = {
      ...rsuFutureVest, id: "g5", grantType: "iso", strikePrice: 10, expirationYear: 2034,
      grantDate: "2024-01-15", sharesGranted: 100,
      strategy: { sellTiming: "hold_then_sell_year", sellYear: 2026 },
      tranches: [{
        id: "t1", vestDate: "2025-01-15", shares: 100, sharesExercised: 100, sharesSold: 0,
        acquiredOn: "2026-02-01", priceAtAcquisition: 100, strategy: null,
      }],
    };
    const p = plan(g);
    p.pricePerShare = 180; p.growthRate = 0;
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2026);
    expect(r.ordinaryIncome).toBeCloseTo(9000, 2);
    expect(r.stCapitalGains).toBeCloseTo(8000, 2);
    expect(r.capitalGains).toBeCloseTo(0, 2);
  });

  it("books a capital loss and zero OI when sold below strike", () => {
    // Grant 1 Jun 2028, sell 2029 (disqualifying, long-term residual). f = 5.
    // OI = lesser(spread 90, max(0, 5−10)=0) = 0. residual = (5−10)×100 = −500.
    const { p, st } = exerciseAndPrep({ grantDate: "2028-06-01" }, 2029);
    p.pricePerShare = 5; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2029);
    expect(r.ordinaryIncome).toBeCloseTo(0, 2);
    expect(r.capitalGains).toBeCloseTo(-500, 2); // clears the exercise leg → long-term
    expect(r.stCapitalGains).toBeCloseTo(0, 2);
  });

  it("gives a genuinely QUALIFYING sale pure capital gain and no ordinary income", () => {
    // Grant 15 Jan 2024, exercise 15 Jan 2027, sell 31 Dec 2029: >2y from grant
    // and >1y from exercise, so §422(a)(1) is satisfied on both legs. The entire
    // gain over the $10 strike basis is long-term — no wages at all.
    const { p, st } = exerciseAndPrep({}, 2029);
    p.pricePerShare = 180; p.growthRate = 0;
    const r = computeEquityYear(p, st, 2029);
    expect(r.ordinaryIncome).toBeCloseTo(0, 2);
    expect(r.capitalGains).toBeCloseTo(17_000, 2); // (180 − 10) × 100
    expect(r.stCapitalGains).toBeCloseTo(0, 2);
  });
});

describe("FICA-exempt equity income (IRC §3121(a)(22))", () => {
  // Three kinds of equity ordinary income share one bucket, but only two are
  // payroll wages. Income from a disqualifying disposition of ISO stock is
  // fully taxable W-2 box 1 income that §3121(a)(22) excludes from FICA — so it
  // has to be reported as a subset of ordinaryIncome, not removed from it.
  const isoGrant: EquityGrant = {
    id: "g-dq", grantNumber: "ISO-DQ", grantType: "iso", grantDate: "2026-01-15", sharesGranted: 10_000,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2036, plannedEvents: [],
    strategy: { exerciseTiming: "at_vest", sellTiming: "immediately" },
    tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 10_000, sharesExercised: 0, sharesSold: 0, strategy: null }],
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
      tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] };
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
    id: "g-split", grantNumber: "NQ-SPLIT", grantType: "nqso", grantDate: "2024-01-15", sharesGranted: 1000,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2034, plannedEvents: [],
    strategy: { exerciseTiming: "specific_year", exerciseYear: 2030, sellTiming: "hold_then_sell_year", sellYear: 2033 },
    tranches: [{ id: "t1", vestDate: "2025-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 400, sharesSold: 0, strategy: null }],
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
      id: "g-lapsed", grantNumber: "NQ-OLD", grantType: "nqso", grantDate: "2018-01-15", sharesGranted: 5000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2025, strategy: null, plannedEvents: [],
      tranches: [{ id: "t1", vestDate: "2020-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 5000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    };
    const p = plan(g);
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, PSY);
    expect(r.ordinaryIncome).toBe(0);      // was 450,000 of phantom W-2 income
    expect(r.strikeCashOutflow).toBe(0);   // was 50,000 of cash spent
  });

  it("books no cash for an option that is under water at its exercise year", () => {
    const g: EquityGrant = {
      id: "g-uw", grantNumber: "NQ-UW", grantType: "nqso", grantDate: "2024-01-15", sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 100, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null, plannedEvents: [],
      tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    };
    const p = plan(g, { pricePerShare: 50 }); // $50 share against a $100 strike
    const st = createEquityState([p], PSY);
    const r = computeEquityYear(p, st, 2027);
    expect(r.strikeCashOutflow).toBe(0);   // was 100,000 spent to buy 50,000 of stock
    expect(r.acquisitions).toHaveLength(0);
  });
});
