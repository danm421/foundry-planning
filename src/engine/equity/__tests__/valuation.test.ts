import { describe, it, expect } from "vitest";
import { remainingGrantValue } from "../valuation";
import type { StockOptionPlan, EquityGrant } from "../types";

const PSY = 2026;
function plan(grant: EquityGrant): StockOptionPlan {
  return { accountId: "so-1", ticker: "ACME", pricePerShare: 100, growthRate: 0,
    destinationAccountId: null, autoCreateDestination: true, sellToCover: false, withholdingRate: 0.22,
    strategy: { exerciseTiming: "at_vest", exerciseYear: null, sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null },
    owner: "client", grants: [grant] };
}

describe("remainingGrantValue", () => {
  it("values unvested RSU shares at FMV before they vest, and excludes them after acquisition", () => {
    const g: EquityGrant = { id: "g1", grantNumber: "RS", grantType: "rsu", grantYear: 2024, sharesGranted: 100,
      has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null, expirationYear: null, strategy: null,
      tranches: [{ id: "t1", vestYear: 2028, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }], plannedEvents: [] };
    expect(remainingGrantValue(plan(g), 2026, PSY)).toBeCloseTo(100 * 100); // unvested → counted
    expect(remainingGrantValue(plan(g), 2028, PSY)).toBeCloseTo(0);          // vested/acquired → moved out
  });

  it("values unexercised options at intrinsic (FMV − strike), floored at 0", () => {
    const g: EquityGrant = { id: "g2", grantNumber: "ISO", grantType: "iso", grantYear: 2024, sharesGranted: 100,
      has83bElection: false, fmvAtGrant: null, strikePrice: 60, strikeDiscountPct: null, expirationYear: 2034,
      strategy: { exerciseTiming: "year_before_expiration" }, // exercises 2033 → stays unexercised through 2026
      tranches: [{ id: "t1", vestYear: 2025, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }], plannedEvents: [] };
    expect(remainingGrantValue(plan(g), 2026, PSY)).toBeCloseTo(100 * (100 - 60)); // intrinsic 40/sh
  });
});

/** A vesting row is a QUANTITY of shares, not a single state. Each of these
 *  rows is partly one thing and partly another; the old per-row boolean
 *  collapsed them and either double-counted or lost the remainder. */
describe("remainingGrantValue — rows that are partly acquired", () => {
  const tranche = (id: string, vestYear: number, shares: number, ex = 0, sold = 0) =>
    ({ id, vestYear, shares, sharesExercised: ex, sharesSold: sold, strategy: null });

  it("counts an 83(b) grant once — the timeline acquires the WHOLE grant on row 0", () => {
    // 40,000 shares at $25 across four rows, granted before the plan starts, so
    // the whole position is seeded into the destination account at plan start.
    // The timeline emits actions for tranches[0] only, so rows 1..3 used to be
    // valued a second time on top of that account: $750,000 of phantom equity.
    const g: EquityGrant = {
      id: "g83", grantNumber: "RS-83b", grantType: "rsu", grantYear: 2024, sharesGranted: 40_000,
      has83bElection: true, fmvAtGrant: 25, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null, plannedEvents: [],
      tranches: [2025, 2026, 2027, 2028].map((y, i) => tranche(`t${i}`, y, 10_000)),
    };
    const p = plan(g);
    p.pricePerShare = 25;
    expect(remainingGrantValue(p, 2026, PSY)).toBeCloseTo(0);
    expect(remainingGrantValue(p, 2040, PSY)).toBeCloseTo(0);
  });

  it("drops a fully-sold RSU row instead of carrying it at FMV forever", () => {
    // Vested in 2025 and every share sold before the plan. The remainder is 0,
    // so the timeline emits nothing at all for the row — which the boolean read
    // as "not yet acquired" and valued at full FMV, permanently.
    const g: EquityGrant = {
      id: "gsold", grantNumber: "RS-2", grantType: "rsu", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null, plannedEvents: [],
      tranches: [tranche("t1", 2025, 1000, 0, 1000)],
    };
    expect(remainingGrantValue(plan(g), 2026, PSY)).toBeCloseTo(0);
    expect(remainingGrantValue(plan(g), 2040, PSY)).toBeCloseTo(0);
  });

  it("keeps the unexercised remainder of a partly-exercised option row", () => {
    // 1,000 options at a $10 strike, 400 already exercised and held. Seeding
    // those 400 flipped the row's boolean, zeroing the 600 shares still under
    // option — $54,000 of intrinsic value missing until the exercise year.
    const g: EquityGrant = {
      id: "gpart", grantNumber: "NQ-1", grantType: "nqso", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2034, strategy: { exerciseTiming: "year_before_expiration" }, plannedEvents: [],
      tranches: [tranche("t1", 2025, 1000, 400, 0)],
    };
    const p = plan(g);
    expect(remainingGrantValue(p, 2026, PSY)).toBeCloseTo(600 * (100 - 10)); // 54,000
    expect(remainingGrantValue(p, 2033, PSY)).toBeCloseTo(0);                // exercised → out
  });

  it("prices the remainder at the requested year, so a balance can be stamped at year-end", () => {
    const g: EquityGrant = {
      id: "gfut", grantNumber: "RS-3", grantType: "rsu", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null, plannedEvents: [],
      tranches: [tranche("t1", 2030, 1000)],
    };
    const p = plan(g);
    p.growthRate = 0.07;
    expect(remainingGrantValue(p, 2026, PSY)).toBeCloseTo(1000 * 100);        // start-of-year default
    expect(remainingGrantValue(p, 2026, PSY, 2027)).toBeCloseTo(1000 * 107);  // grown through year-end
  });
});

/** The exercise gate lives in the timeline precisely so the balance sheet and
 *  the tax ledger cannot disagree. These are the balance-sheet half: move the
 *  gate into tax-events alone and the shares silently leave net worth. */
describe("remainingGrantValue — options the plan never exercises", () => {
  it("keeps an unexercised out-of-the-money option on the books until it expires", () => {
    // $100 strike; the share is $57.50 at the 2027 vest, so the plan does not
    // exercise. The OPTION still exists until 2034 — and once the share price
    // grows past the strike it is worth real money again. If the gate lived in
    // the tax ledger alone, the balance sheet would have dropped these shares
    // at 2027 and this recovery would read as $0.
    const g: EquityGrant = {
      id: "guw", grantNumber: "NQ-UW", grantType: "nqso", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 100, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null, plannedEvents: [],
      tranches: [{ id: "t1", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    };
    const p = plan(g);
    p.pricePerShare = 50;
    p.growthRate = 0.15;
    const fmv = (y: number) => 50 * 1.15 ** (y - PSY);
    expect(fmv(2027)).toBeLessThan(100);                       // under water at vest
    expect(remainingGrantValue(p, 2027, PSY)).toBeCloseTo(0);  // intrinsic floored at 0
    expect(remainingGrantValue(p, 2033, PSY)).toBeCloseTo(1000 * (fmv(2033) - 100), 4);
    expect(remainingGrantValue(p, 2034, PSY)).toBeCloseTo(0);  // expired → off the books
  });

  it("drops an option that lapsed before the plan started", () => {
    const g: EquityGrant = {
      id: "glapsed", grantNumber: "NQ-OLD", grantType: "nqso", grantYear: 2018, sharesGranted: 5000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2025, strategy: null, plannedEvents: [],
      tranches: [{ id: "t1", vestYear: 2020, shares: 5000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    };
    expect(remainingGrantValue(plan(g), 2026, PSY)).toBeCloseTo(0);
  });
});
