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

describe("buildFutureActivity — edge behavior", () => {
  it("flags an unexercised expiry as underwater with $0 value, price = projected FMV", () => {
    // exerciseTiming "manual" with no planned events → never exercised → expires at expirationYear.
    const g = nqso({ expirationYear: 2030 });
    const m = buildFutureActivity([plan([g], MANUAL_NO_EVENTS)], OPTS);
    expect(m.groups).toHaveLength(1);
    const e = m.groups[0].events[0];
    expect(e.year).toBe(2030);
    expect(e.kind).toBe("expire");
    expect(e.underwater).toBe(true);
    expect(e.grossValue).toBe(0);
    expect(e.pricePerShare).toBe(40); // FMV still shown (muted in the view)
    expect(e.netCash).toBeNull();
    expect(e.exerciseCost).toBeNull();
  });

  it("drops seed_held but keeps sells generated from a seeded (pre-plan) position", () => {
    // RSU tranche vested in 2024 (< planStartYear) → seed_held in 2026; immediate sell also in 2026.
    const g = rsu({ tranches: [{ id: "rt1", vestYear: 2024, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const m = buildFutureActivity([plan([g], SELL_NOW)], OPTS);
    const kinds = m.groups.flatMap((grp) => grp.events.map((e) => e.kind));
    expect(kinds).toEqual(["sell"]);          // no "vest"/"seed_held"
    expect(m.groups[0].year).toBe(2026);
    expect(m.groups[0].events[0].shares).toBe(1000);
  });

  it("caps the horizon at planEndYear", () => {
    // Two RSU tranches: one vests in-window (2028), one beyond planEndYear (2032).
    const g = rsu({
      sharesGranted: 2000,
      tranches: [
        { id: "rt1", vestYear: 2028, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "rt2", vestYear: 2032, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
      ],
    });
    const m = buildFutureActivity([plan([g], HOLD)], { asOfYear: 2026, planStartYear: 2026, planEndYear: 2030 });
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].year).toBe(2028);
    expect(m.groups[0].events[0].trancheLabel).toBe("T1");
  });
});

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

describe("buildFutureActivity — totals, tax seam, empty states", () => {
  it("reconciles grand totals across years and leaves taxImpact null / hasTaxImpact false", () => {
    // RSU vests 2027 (hold) + NQSO exercises 2027 (hold). Use distinct accounts to avoid id clashes.
    const m = buildFutureActivity(
      [plan([rsu()], HOLD), plan([nqso()], HOLD, { accountId: "acct2", ticker: "ACME" })],
      OPTS,
    );
    const all = m.groups.flatMap((g) => g.events);
    const sumShares = all.reduce((s, e) => s + e.shares, 0);
    const sumGross = all.reduce((s, e) => s + e.grossValue, 0);
    expect(m.totals.shares).toBe(sumShares);
    expect(m.totals.grossValue).toBe(sumGross);
    expect(m.hasTaxImpact).toBe(false);
    expect(m.totals.taxImpact).toBeNull();
    expect(all.every((e) => e.taxImpact === null)).toBe(true);
    expect(m.groups.every((g) => g.subtotal.taxImpact === null)).toBe(true);
  });

  it("reports hasGrants=false with empty groups when there are no grants", () => {
    const m = buildFutureActivity([plan([], HOLD)], OPTS);
    expect(m.groups).toEqual([]);
    expect(m.hasGrants).toBe(false);
    expect(m.totals.shares).toBe(0);
  });

  it("reports hasGrants=true with empty groups when grants have no in-window activity", () => {
    // Held RSU that fully vested before the plan and is never sold → only seed_held (dropped).
    const g = rsu({ tranches: [{ id: "rt1", vestYear: 2020, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const m = buildFutureActivity([plan([g], HOLD)], OPTS);
    expect(m.groups).toEqual([]);
    expect(m.hasGrants).toBe(true);
  });

  it("handles an empty plans array", () => {
    const m = buildFutureActivity([], OPTS);
    expect(m.groups).toEqual([]);
    expect(m.hasGrants).toBe(false);
    expect(m.totals).toEqual({ shares: 0, grossValue: 0, exerciseCost: 0, netCash: 0, taxImpact: null });
  });
});
