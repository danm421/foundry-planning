import { describe, it, expect } from "vitest";
import { buildFutureActivity } from "../future-activity";
import type { StockOptionPlan, EquityGrant, EquityStrategy } from "../types";

// growthRate 0 → projected FMV is flat at pricePerShare (40) for deterministic math.
const HOLD: EquityStrategy = {
  exerciseTiming: "at_vest", exerciseYear: null,
  sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null,
};
const SELL_NOW: EquityStrategy = { ...HOLD, sellTiming: "immediately" };
const MANUAL_NO_EVENTS: EquityStrategy = { ...HOLD, exerciseTiming: "manual" };

const OPTS = { asOfYear: 2026, planStartYear: 2026, planEndYear: 2035 };

function plan(
  grants: EquityGrant[],
  strategy: EquityStrategy = HOLD,
  over: Partial<StockOptionPlan> = {},
): StockOptionPlan {
  return {
    accountId: "acct1", ticker: "ACME", pricePerShare: 40, growthRate: 0,
    destinationAccountId: null, autoCreateDestination: false, sellToCover: false,
    withholdingRate: 0, strategy, owner: "client", grants, ...over,
  };
}

function rsu(over: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g-rsu", grantNumber: "RSU-09", grantType: "rsu", grantYear: 2026,
    sharesGranted: 1000, has83bElection: false, fmvAtGrant: null, strikePrice: null,
    strikeDiscountPct: null, expirationYear: null, strategy: null,
    tranches: [{ id: "rt1", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [], ...over,
  };
}

function nqso(over: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g-nq", grantNumber: "NQSO-17", grantType: "nqso", grantYear: 2024,
    sharesGranted: 1000, has83bElection: false, fmvAtGrant: null, strikePrice: 20,
    strikeDiscountPct: null, expirationYear: 2031, strategy: null,
    tranches: [{ id: "nt1", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [], ...over,
  };
}

describe("buildFutureActivity — core mapping", () => {
  it("maps an RSU vest to a Vest event valued at projected FMV", () => {
    const m = buildFutureActivity([plan([rsu()], HOLD)], OPTS);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].year).toBe(2027);
    const e = m.groups[0].events[0];
    expect(e.kind).toBe("vest");
    expect(e.shares).toBe(1000);
    expect(e.pricePerShare).toBe(40);
    expect(e.grossValue).toBe(40000);
    expect(e.exerciseCost).toBeNull();
    expect(e.netCash).toBeNull();
    expect(e.grantLabel).toBe("RSU-09");
    expect(e.trancheLabel).toBe("T1");
    expect(e.ticker).toBe("ACME");
  });

  it("maps an option exercise to intrinsic value + negative net cash", () => {
    const m = buildFutureActivity([plan([nqso()], HOLD)], OPTS);
    const e = m.groups[0].events[0];
    expect(e.kind).toBe("exercise");
    expect(e.grossValue).toBe(20000); // 1000 * (40 - 20)
    expect(e.exerciseCost).toBe(20000); // 1000 * 20
    expect(e.netCash).toBe(-20000);
  });

  it("maps a sell to proceeds + positive net cash, ordered after the vest", () => {
    const m = buildFutureActivity([plan([rsu()], SELL_NOW)], OPTS);
    const evs = m.groups[0].events;
    expect(evs.map((e) => e.kind)).toEqual(["vest", "sell"]);
    const sell = evs[1];
    expect(sell.grossValue).toBe(40000);
    expect(sell.netCash).toBe(40000);
    expect(m.groups[0].subtotal.shares).toBe(2000);
    expect(m.groups[0].subtotal.grossValue).toBe(80000);
    expect(m.groups[0].subtotal.netCash).toBe(40000);
  });
});
