// src/lib/accounts/__tests__/equity-derived-values.test.ts
import { describe, it, expect } from "vitest";
import { withDerivedEquityValues } from "../equity-derived-values";
import type { StockOptionPlan, EquityGrant } from "@/engine/equity/types";

const PSY = 2026;

/** 1,000 shares at $100, vesting after the plan starts — so every share is
 *  still IN the grant at plan start and the whole position is the derived
 *  balance. Matches the fixture idiom in `engine/equity/__tests__`. */
const rsuGrant: EquityGrant = {
  id: "g1",
  grantNumber: "RS-1",
  grantType: "rsu",
  grantYear: 2024,
  sharesGranted: 1000,
  has83bElection: false,
  fmvAtGrant: null,
  strikePrice: null,
  strikeDiscountPct: null,
  expirationYear: null,
  strategy: null,
  tranches: [{ id: "t1", vestYear: 2030, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
  plannedEvents: [],
};

const plan = (over: Partial<StockOptionPlan> = {}): StockOptionPlan => ({
  accountId: "so-1",
  ticker: "TSLA",
  pricePerShare: 100,
  growthRate: 0,
  destinationAccountId: null,
  autoCreateDestination: true,
  sellToCover: false,
  withholdingRate: 0.22,
  strategy: {
    exerciseTiming: "at_vest",
    exerciseYear: null,
    sellTiming: "hold",
    sellYear: null,
    sellPercentPerYear: null,
    sellStartYear: null,
  },
  owner: "client",
  grants: [rsuGrant],
  ...over,
});

const acct = (id: string, value: number) => ({ id, name: id, value });

describe("withDerivedEquityValues", () => {
  it("replaces the stored 0 on a stock_options account with the grant value", () => {
    const out = withDerivedEquityValues([acct("so-1", 0)], [plan()], PSY);

    // 1,000 unvested RSU shares × $100 — the position the DB records as "0".
    expect(out[0].value).toBe(100_000);
  });

  it("leaves every account with no plan of its own untouched", () => {
    const out = withDerivedEquityValues(
      [acct("taxable-1", 250_000), acct("so-1", 0)],
      [plan()],
      PSY,
    );

    expect(out[0]).toEqual({ id: "taxable-1", name: "taxable-1", value: 250_000 });
  });

  it("returns the accounts unchanged when the tree carries no plans", () => {
    const accounts = [acct("so-1", 0)];

    expect(withDerivedEquityValues(accounts, undefined, PSY)).toEqual(accounts);
    expect(withDerivedEquityValues(accounts, [], PSY)).toEqual(accounts);
  });

  it("does not mutate the accounts it was given", () => {
    const accounts = [acct("so-1", 0)];
    withDerivedEquityValues(accounts, [plan()], PSY);

    // The caller's tree feeds the PROJECTION as well as the display. Handing
    // back a mutated array would push the derived balance into the engine's
    // growth loop — the phantom-growth failure that ruled out persisting this
    // number in the first place.
    expect(accounts[0].value).toBe(0);
  });

  it("prices the balance at plan start, not a year ahead", () => {
    // 10%/yr appreciation: $100 at plan start, $110 a year later. The
    // projection deliberately asks for `year + 1` to stamp a year-END balance;
    // a "today" figure must NOT do that or the Balance Sheet reads a year
    // ahead of every other account on the page.
    const out = withDerivedEquityValues([acct("so-1", 0)], [plan({ growthRate: 0.1 })], PSY);

    expect(out[0].value).toBeCloseTo(100_000);
  });
});
