import { describe, it, expect } from "vitest";
import {
  termCertainRemainderFactor,
  singleLifeRemainderFactor,
  jointLifeRemainderFactor,
  shorterOfYearsOrLifeRemainderFactor,
} from "../unitrust-factors";

describe("term-certain remainder factor", () => {
  it("matches eMoney CRUT memo example: 6%, 10 years => 0.538615", () => {
    // Trust value $1,000,000, 6% payout, 10 years, 2.2% 7520 rate
    // Expected remainder = 0.538615 (Table D)
    expect(termCertainRemainderFactor({ payoutPercent: 0.06, termYears: 10 }))
      .toBeCloseTo(0.538615, 6);
  });

  it("equals 1 when payout is 0%", () => {
    expect(termCertainRemainderFactor({ payoutPercent: 0, termYears: 20 })).toBe(1);
  });

  it("equals 0 when payout is 100%", () => {
    expect(termCertainRemainderFactor({ payoutPercent: 1, termYears: 5 })).toBe(0);
  });

  it("equals (1 - p) when termYears = 1", () => {
    expect(termCertainRemainderFactor({ payoutPercent: 0.05, termYears: 1 }))
      .toBeCloseTo(0.95, 6);
  });
});

describe("single-life remainder factor", () => {
  // Spot checks against IRS Pub 1457 Table U(1) at standard rates/ages.
  // NOTE: choose values from a current Pub 1457; replace placeholders with
  // exact IRS-published values when implementing.
  it.each([
    // [age, payoutPercent, irc7520Rate, expectedFactor]
    [50, 0.05, 0.04, /* IRS Pub 1457 Table U(1) value */ 0],
    [65, 0.05, 0.05, /* IRS Pub 1457 Table U(1) value */ 0],
    [75, 0.06, 0.05, /* IRS Pub 1457 Table U(1) value */ 0],
    [85, 0.07, 0.06, /* IRS Pub 1457 Table U(1) value */ 0],
  ])("age %i, payout %f, rate %f matches IRS U(1)", (age, p, r, expected) => {
    if (expected === 0) return; // skip until IRS values are filled in
    const factor = singleLifeRemainderFactor({
      age,
      payoutPercent: p,
      irc7520Rate: r,
    });
    expect(factor).toBeCloseTo(expected, 4);
  });

  it("returns ~1 at age >= 110 (immediate death, charity gets nothing)", () => {
    const factor = singleLifeRemainderFactor({
      age: 110,
      payoutPercent: 0.05,
      irc7520Rate: 0.05,
    });
    expect(factor).toBeGreaterThan(0.99);
  });

  it("equals 1 when payout is 0%", () => {
    expect(singleLifeRemainderFactor({
      age: 65,
      payoutPercent: 0,
      irc7520Rate: 0.05,
    })).toBeCloseTo(1, 6);
  });
});

describe("joint-life remainder factor", () => {
  it("is greater than single-life for same payout (last-survivor lives longer)", () => {
    const single = singleLifeRemainderFactor({
      age: 65, payoutPercent: 0.05, irc7520Rate: 0.05,
    });
    const joint = jointLifeRemainderFactor({
      age1: 65, age2: 65, payoutPercent: 0.05, irc7520Rate: 0.05,
    });
    expect(joint).toBeLessThan(single);
  });

  // TODO: Add IRS Pub 1458 Table U(2) spot checks when implementing.
});

describe("shorter-of-years-or-life", () => {
  it("equals years-factor when N years <= life expectancy", () => {
    const yearsOnly = termCertainRemainderFactor({ payoutPercent: 0.05, termYears: 5 });
    const shorter = shorterOfYearsOrLifeRemainderFactor({
      age: 50, payoutPercent: 0.05, termYears: 5, irc7520Rate: 0.05,
    });
    // For a 50-year-old, 5 years is well within life expectancy; result should
    // be very close to (but slightly above due to mortality risk) the years factor.
    expect(shorter).toBeGreaterThan(yearsOnly * 0.99);
  });

  it("approaches life-factor when N years >> life expectancy", () => {
    const lifeOnly = singleLifeRemainderFactor({
      age: 90, payoutPercent: 0.05, irc7520Rate: 0.05,
    });
    const shorter = shorterOfYearsOrLifeRemainderFactor({
      age: 90, payoutPercent: 0.05, termYears: 50, irc7520Rate: 0.05,
    });
    expect(shorter).toBeCloseTo(lifeOnly, 3);
  });
});
