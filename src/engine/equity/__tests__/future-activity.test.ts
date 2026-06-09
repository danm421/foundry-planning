import { describe, it, expect } from "vitest";
import { buildFutureActivity } from "../future-activity";
import type { StockOptionPlan, EquityGrant, EquityStrategy } from "../types";

// growthRate 0 → projected FMV flat at pricePerShare (100) for deterministic math.
const HOLD: EquityStrategy = {
  exerciseTiming: "at_vest", exerciseYear: null,
  sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null,
};
const SELL_NOW: EquityStrategy = { ...HOLD, sellTiming: "immediately" };
const MANUAL_NO_EVENTS: EquityStrategy = { ...HOLD, exerciseTiming: "manual" };

const OPTS = { asOfYear: 2026, planStartYear: 2026, planEndYear: 2035 };

function plan(grants: EquityGrant[], strategy: EquityStrategy = HOLD, over: Partial<StockOptionPlan> = {}): StockOptionPlan {
  return {
    accountId: "acct1", ticker: "ACME", pricePerShare: 100, growthRate: 0,
    destinationAccountId: "dest", autoCreateDestination: false, sellToCover: false,
    withholdingRate: 0, strategy, owner: "client", grants, ...over,
  };
}

function rsu(over: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g-rsu", grantNumber: "RSU-09", grantType: "rsu", grantYear: 2026,
    sharesGranted: 100, has83bElection: false, fmvAtGrant: null, strikePrice: null,
    strikeDiscountPct: null, expirationYear: null, strategy: null,
    tranches: [{ id: "rt1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [], ...over,
  };
}

function nqso(over: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g-nq", grantNumber: "NQSO-17", grantType: "nqso", grantYear: 2024,
    sharesGranted: 100, has83bElection: false, fmvAtGrant: null, strikePrice: 20,
    strikeDiscountPct: null, expirationYear: 2031, strategy: null,
    tranches: [{ id: "nt1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [], ...over,
  };
}

describe("buildFutureActivity — grant-level rows", () => {
  it("maps an RSU vest (no sell-to-cover) to a row with vested shares, no proceeds", () => {
    const m = buildFutureActivity([plan([rsu()], HOLD)], OPTS);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].year).toBe(2027);
    const r = m.groups[0].rows[0];
    expect(r.grantNumber).toBe("RSU-09");
    expect(r.grantType).toBe("rsu");
    expect(r.sharesVested).toBe(100);
    expect(r.sharesSold).toBe(0);
    expect(r.hasSellToCover).toBe(false);
    expect(r.grossProceeds).toBe(0);
    expect(r.netProceeds).toBe(0);
    expect(r.salePrice).toBe(100);
  });

  it("surfaces sell-to-cover at an RSU vest: cover shares sold, tagged, net proceeds = cover proceeds", () => {
    const m = buildFutureActivity([plan([rsu()], HOLD, { sellToCover: true, withholdingRate: 0.25 })], OPTS);
    const r = m.groups[0].rows[0];
    expect(r.sharesVested).toBe(100);
    expect(r.sharesSold).toBeCloseTo(25, 6);
    expect(r.hasSellToCover).toBe(true);
    expect(r.grossProceeds).toBeCloseTo(2500, 6);
    expect(r.netProceeds).toBeCloseTo(2500, 6);
  });

  it("does not double-sell: vest + sell-to-cover + sell-all stays at gross shares", () => {
    // 100 vest, 25 sold to cover, then 'immediately' sell the remaining 75 → 100 total sold.
    const m = buildFutureActivity([plan([rsu()], SELL_NOW, { sellToCover: true, withholdingRate: 0.25 })], OPTS);
    const r = m.groups[0].rows[0];
    expect(r.sharesVested).toBe(100);
    expect(r.sharesSold).toBeCloseTo(100, 6); // 25 cover + 75 strategy, NOT 125
    expect(r.grossProceeds).toBeCloseTo(10000, 6);
    expect(r.netProceeds).toBeCloseTo(10000, 6);
    expect(r.hasSellToCover).toBe(true);
  });

  it("maps an NQSO exercise: exercised shares, exercise cost, negative net proceeds", () => {
    const m = buildFutureActivity([plan([nqso()], HOLD)], OPTS);
    const r = m.groups.find((g) => g.year === 2027)!.rows[0];
    expect(r.sharesExercised).toBe(100);
    expect(r.exercisePrice).toBe(20);
    expect(r.exerciseCost).toBe(2000);          // 100 * 20
    expect(r.grossProceeds).toBe(0);            // held, nothing sold
    expect(r.netProceeds).toBe(-2000);          // − exercise cost
  });

  it("ISO exercise produces no sell-to-cover", () => {
    const iso = nqso({ id: "g-iso", grantNumber: "ISO-01", grantType: "iso" });
    const m = buildFutureActivity([plan([iso], HOLD, { sellToCover: true, withholdingRate: 0.25 })], OPTS);
    const r = m.groups.find((g) => g.year === 2027)!.rows[0];
    expect(r.sharesSold).toBe(0);
    expect(r.hasSellToCover).toBe(false);
  });

  it("flags an unexercised expiry as an underwater row", () => {
    const g = nqso({ expirationYear: 2030 });
    const m = buildFutureActivity([plan([g], MANUAL_NO_EVENTS)], OPTS);
    const r = m.groups.find((grp) => grp.year === 2030)!.rows[0];
    expect(r.underwater).toBe(true);
    expect(r.expiredShares).toBe(100);
    expect(r.grossProceeds).toBe(0);
  });

  it("caps the horizon at planEndYear", () => {
    const g = rsu({
      sharesGranted: 200,
      tranches: [
        { id: "rt1", vestYear: 2028, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "rt2", vestYear: 2032, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null },
      ],
    });
    const m = buildFutureActivity([plan([g], HOLD)], { asOfYear: 2026, planStartYear: 2026, planEndYear: 2030 });
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].year).toBe(2028);
  });

  it("reconciles grand totals and leaves taxImpact null / hasTaxImpact false", () => {
    const m = buildFutureActivity(
      [plan([rsu()], HOLD), plan([nqso()], HOLD, { accountId: "acct2" })],
      OPTS,
    );
    const allRows = m.groups.flatMap((g) => g.rows);
    const sumVested = allRows.reduce((s, r) => s + r.sharesVested, 0);
    const sumNet = allRows.reduce((s, r) => s + r.netProceeds, 0);
    expect(m.totals.sharesVested).toBeCloseTo(sumVested, 6);
    expect(m.totals.netProceeds).toBeCloseTo(sumNet, 6);
    expect(m.hasTaxImpact).toBe(false);
    expect(m.totals.taxImpact).toBeNull();
  });

  it("reports empty groups + hasGrants flags correctly", () => {
    expect(buildFutureActivity([plan([], HOLD)], OPTS).hasGrants).toBe(false);
    expect(buildFutureActivity([], OPTS).groups).toEqual([]);
    const held = rsu({ tranches: [{ id: "rt1", vestYear: 2020, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const m = buildFutureActivity([plan([held], HOLD)], OPTS);
    expect(m.groups).toEqual([]);
    expect(m.hasGrants).toBe(true);
  });
});

describe("buildFutureActivity — tax impact join", () => {
  it("joins per-year tax onto the subtotal + grand total, leaving per-grant rows null", () => {
    const taxByYear = new Map([[2027, 5000]]);
    const m = buildFutureActivity([plan([rsu()], HOLD)], { ...OPTS, taxByYear });
    expect(m.hasTaxImpact).toBe(true);
    const g = m.groups.find((grp) => grp.year === 2027)!;
    expect(g.subtotal.taxImpact).toBe(5000);
    expect(g.rows[0].taxImpact).toBeNull(); // joint per-year figure, not split per grant
    expect(m.totals.taxImpact).toBe(5000);
  });

  it("sums only present years; a year with activity but no tax entry stays null (not 0)", () => {
    const twoVests = rsu({
      sharesGranted: 200,
      tranches: [
        { id: "rt1", vestYear: 2027, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "rt2", vestYear: 2029, shares: 100, sharesExercised: 0, sharesSold: 0, strategy: null },
      ],
    });
    const taxByYear = new Map([[2027, 5000]]); // 2029 deliberately absent
    const m = buildFutureActivity([plan([twoVests], HOLD)], { ...OPTS, taxByYear });
    expect(m.groups.find((grp) => grp.year === 2027)!.subtotal.taxImpact).toBe(5000);
    expect(m.groups.find((grp) => grp.year === 2029)!.subtotal.taxImpact).toBeNull();
    expect(m.totals.taxImpact).toBe(5000); // present year only — 2029 not coerced to 0
  });
});
