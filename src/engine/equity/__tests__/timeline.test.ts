import { describe, it, expect } from "vitest";
import { buildGrantTimeline } from "../timeline";
import type { EquityGrant } from "../types";

const PSY = 2026; // planStartYear
// Share price the timeline consults for moneyness. Every option fixture below
// has a strike well under 100, so all of them stay in the money.
const FMV = () => 100;

function rsu(over: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g1", grantNumber: "RS-1", grantType: "rsu", grantYear: 2024, sharesGranted: 1000,
    has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
    expirationYear: null, strategy: null,
    tranches: [
      { id: "t1", vestYear: 2025, shares: 250, sharesExercised: 0, sharesSold: 0, strategy: null },
      { id: "t2", vestYear: 2027, shares: 250, sharesExercised: 0, sharesSold: 0, strategy: null },
    ],
    plannedEvents: [],
    ...over,
  };
}

describe("buildGrantTimeline — RSU", () => {
  it("seeds an already-vested tranche as held at planStartYear and schedules a future vest as acquire", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(rsu(), acct, PSY, FMV);
    expect(actions).toContainEqual({ year: PSY, kind: "seed_held", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 250 });
    expect(actions).toContainEqual({ year: 2027, kind: "acquire_rsu", grantId: "g1", trancheId: "t2", lotId: "t2#acq", shares: 250 });
  });

  it("subtracts already-sold actuals from seeded held shares", () => {
    const g = rsu();
    g.tranches[0].sharesSold = 100;
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    expect(actions).toContainEqual({ year: PSY, kind: "seed_held", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 150 });
  });

  it("83(b): acquires all granted shares at the grant year (held), no per-tranche acquire", () => {
    const g = rsu({ has83bElection: true, fmvAtGrant: 5, grantYear: 2026 });
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    expect(actions).toContainEqual({ year: 2026, kind: "acquire_rsu", grantId: "g1", trancheId: "t1", lotId: "t1#acq", shares: 1000 });
    expect(actions.filter((a) => a.kind === "acquire_rsu")).toHaveLength(1);
  });
});

describe("buildGrantTimeline — NQSO/ISO", () => {
  const optGrant = (): EquityGrant => ({
    id: "g2", grantNumber: "ISO-1", grantType: "iso", grantYear: 2024, sharesGranted: 400,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2034, strategy: null,
    tranches: [{ id: "t1", vestYear: 2027, shares: 400, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [],
  });

  it("at_vest exercises in the vest year and holds", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY, FMV);
    expect(actions).toContainEqual({ year: 2027, kind: "exercise", grantId: "g2", trancheId: "t1", lotId: "t1#ex", shares: 400 });
  });

  it("year_before_expiration exercises the year before expiry", () => {
    const acct = { exerciseTiming: "year_before_expiration" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY, FMV);
    expect(actions).toContainEqual({ year: 2033, kind: "exercise", grantId: "g2", trancheId: "t1", lotId: "t1#ex", shares: 400 });
  });

  it("expires unexercised shares at expiration when never exercised (sellTiming hold, exerciseTiming manual, no planned events)", () => {
    const acct = { exerciseTiming: "manual" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY, FMV);
    expect(actions).toContainEqual({ year: 2034, kind: "expire", grantId: "g2", trancheId: "t1", lotId: "t1#ex", shares: 400 });
  });
});

describe("buildGrantTimeline — sells", () => {
  it("percent_per_year schedules a sell of the remaining held each year from the start year", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "percent_per_year" as const, sellYear: null, sellPercentPerYear: 0.5, sellStartYear: 2026 };
    // single already-vested tranche of 200 held at PSY
    const g = rsu({ tranches: [{ id: "t1", vestYear: 2025, shares: 200, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const actions = buildGrantTimeline(g, acct, PSY, FMV).filter((a) => a.kind === "sell");
    // 2026 sells 100 (50% of 200), 2027 sells 50 (50% of remaining 100), etc.
    expect(actions[0]).toEqual({ year: 2026, kind: "sell", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 100 });
    expect(actions[1]).toEqual({ year: 2027, kind: "sell", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 50 });
  });

  it("immediately sells in the same year as acquisition (cashless)", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "immediately" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const g = rsu({ tranches: [{ id: "t1", vestYear: 2028, shares: 300, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    expect(actions).toContainEqual({ year: 2028, kind: "acquire_rsu", grantId: "g1", trancheId: "t1", lotId: "t1#acq", shares: 300 });
    expect(actions).toContainEqual({ year: 2028, kind: "sell", grantId: "g1", trancheId: "t1", lotId: "t1#acq", shares: 300 });
  });
});

describe("buildGrantTimeline — options that should never be exercised", () => {
  const lapsed = (): EquityGrant => ({
    id: "g3", grantNumber: "NQ-OLD", grantType: "nqso", grantYear: 2018, sharesGranted: 5000,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2025, strategy: null, // expired BEFORE the plan starts
    tranches: [{ id: "t1", vestYear: 2020, shares: 5000, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [],
  });

  it("does not exercise an option that lapsed before the plan started", () => {
    // The exercise year (2020, at vest) passed the expiry test against the
    // ORIGINAL year, then got pushed forward to the first plan year without
    // being re-tested — booking a 2026 exercise on a 2025-expired option.
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(lapsed(), acct, PSY, FMV);
    expect(actions.filter((a) => a.kind === "exercise")).toHaveLength(0);
    expect(actions.some((a) => a.kind === "expire" && a.shares === 5000)).toBe(true);
  });

  it("still exercises an option whose expiry is after the plan starts", () => {
    const g = lapsed();
    g.expirationYear = 2030;
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    expect(actions).toContainEqual({ year: PSY, kind: "exercise", grantId: "g3", trancheId: "t1", lotId: "t1#ex", shares: 5000 });
  });

  it("does not exercise an option that is out of the money", () => {
    // 1,000 shares, $100 strike, $50 share price: exercising spends $100,000 to
    // buy $50,000 of stock. Exercisability was decided from dates alone.
    const g: EquityGrant = {
      id: "g4", grantNumber: "NQ-UW", grantType: "nqso", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 100, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null,
      tranches: [{ id: "t1", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
      plannedEvents: [],
    };
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY, () => 50);
    expect(actions.filter((a) => a.kind === "exercise")).toHaveLength(0);
    expect(actions.some((a) => a.kind === "expire")).toBe(true);
    // In the money at the same date → exercised as normal.
    expect(buildGrantTimeline(g, acct, PSY, () => 150).filter((a) => a.kind === "exercise")).toHaveLength(1);
  });

  it("gives each acquisition event on one row its own lot id", () => {
    // 400 of 1,000 already exercised and held: the seeded lot and the
    // newly-exercised lot are different lots on the same vesting row, and one
    // `lots.set` used to overwrite the other.
    const g: EquityGrant = {
      id: "g5", grantNumber: "NQ-SPLIT", grantType: "nqso", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null,
      tranches: [{ id: "t1", vestYear: 2025, shares: 1000, sharesExercised: 400, sharesSold: 0, strategy: null }],
      plannedEvents: [],
    };
    const acct = { exerciseTiming: "specific_year" as const, exerciseYear: 2030, sellTiming: "hold_then_sell_year" as const, sellYear: 2033, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    const lotIds = new Set(actions.map((a) => a.lotId));
    expect(lotIds).toEqual(new Set(["t1#seed", "t1#ex"]));
    // Each sell names the acquisition it came from.
    const sells = actions.filter((a) => a.kind === "sell");
    expect(sells.map((s) => [s.lotId, s.shares])).toEqual([["t1#seed", 400], ["t1#ex", 600]]);
  });
});

describe("buildGrantTimeline — planned sell events (F43/F48)", () => {
  const HOLD = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };

  /** Four 1,000-share RSU tranches, all vesting inside the plan. */
  function fourRowRsu(plannedEvents: EquityGrant["plannedEvents"]): EquityGrant {
    return {
      id: "gpe", grantNumber: "RS-PE", grantType: "rsu", grantYear: 2025, sharesGranted: 4000,
      has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null,
      tranches: [2027, 2028, 2029, 2030].map((y, i) => ({
        id: `t${i + 1}`, vestYear: y, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null,
      })),
      plannedEvents,
    };
  }

  const soldShares = (g: EquityGrant, acct = HOLD) =>
    buildGrantTimeline(g, acct, PSY, FMV).filter((a) => a.kind === "sell").reduce((s, a) => s + a.shares, 0);

  it("sells a grant-level share count ONCE across the grant, not once per row", () => {
    // "Sell 1,000 shares in 2030" on a four-row grant sold 1,000 from every
    // row — 4,000 shares, the entire position, $200,000 at $50 a share.
    const g = fourRowRsu([{ year: 2030, action: "sell", shares: 1000, pct: null, trancheId: null }]);
    expect(soldShares(g)).toBe(1000);
  });

  it("draws the budget from the earliest-vesting rows first", () => {
    const g = fourRowRsu([{ year: 2030, action: "sell", shares: 2500, pct: null, trancheId: null }]);
    const sells = buildGrantTimeline(g, HOLD, PSY, FMV).filter((a) => a.kind === "sell");
    expect(sells.map((s) => [s.trancheId, s.shares])).toEqual([
      ["t1", 1000], ["t2", 1000], ["t3", 500],
    ]);
  });

  it("never sells more than the grant holds", () => {
    const g = fourRowRsu([{ year: 2031, action: "sell", shares: 99_999, pct: null, trancheId: null }]);
    expect(soldShares(g)).toBe(4000);
  });

  it("keeps each event's budget separate", () => {
    const g = fourRowRsu([
      { year: 2030, action: "sell", shares: 1000, pct: null, trancheId: null },
      { year: 2031, action: "sell", shares: 1500, pct: null, trancheId: null },
    ]);
    expect(soldShares(g)).toBe(2500);
  });

  it("leaves a PERCENTAGE event per-row, where 25% of each row is 25% of the grant", () => {
    const g = fourRowRsu([{ year: 2030, action: "sell", shares: null, pct: 0.25, trancheId: null }]);
    expect(soldShares(g)).toBe(1000);
    const sells = buildGrantTimeline(g, HOLD, PSY, FMV).filter((a) => a.kind === "sell");
    expect(sells.map((s) => s.shares)).toEqual([250, 250, 250, 250]);
  });

  it("leaves a share-less, pct-less event per-row — it means 'sell this row'", () => {
    const g = fourRowRsu([{ year: 2030, action: "sell", shares: null, pct: null, trancheId: null }]);
    expect(soldShares(g)).toBe(4000);
  });

  it("fills the earliest event first, whatever order the events were stored in", () => {
    // Draw order decides WHICH row satisfies WHICH event, and a sell can never
    // precede the vest it came from. Two far-apart rows and two far-apart
    // events, declared newest-first: the 2028 sale must come out of the row
    // that vests in 2027, or it gets dragged forward to 2035.
    const g: EquityGrant = {
      id: "gord", grantNumber: "RS-ORD", grantType: "rsu", grantYear: 2025, sharesGranted: 2000,
      has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null,
      tranches: [
        { id: "t1", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "t2", vestYear: 2035, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
      ],
      plannedEvents: [
        { year: 2036, action: "sell", shares: 1000, pct: null, trancheId: null },
        { year: 2028, action: "sell", shares: 1000, pct: null, trancheId: null },
      ],
    };
    const sells = buildGrantTimeline(g, HOLD, PSY, FMV).filter((a) => a.kind === "sell");
    expect(sells.map((s) => [s.trancheId, s.year, s.shares])).toEqual([
      ["t1", 2028, 1000],
      ["t2", 2036, 1000],
    ]);
  });

  it("leaves a TRANCHE-targeted share count alone — it already names one row", () => {
    const g = fourRowRsu([{ year: 2030, action: "sell", shares: 600, pct: null, trancheId: "t2" }]);
    const sells = buildGrantTimeline(g, HOLD, PSY, FMV).filter((a) => a.kind === "sell");
    expect(sells.map((s) => [s.trancheId, s.shares])).toEqual([["t2", 600]]);
  });

  it("splits one budget across the two lots a single option row can hold", () => {
    // 400 of 1,000 already exercised and held: the seeded lot and the lot the
    // plan exercises are separate acquisitions on the same row, and the old
    // code handed the full 600 to each.
    const g: EquityGrant = {
      id: "gpe2", grantNumber: "NQ-PE", grantType: "nqso", grantYear: 2024, sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null,
      tranches: [{ id: "t1", vestYear: 2025, shares: 1000, sharesExercised: 400, sharesSold: 0, strategy: null }],
      plannedEvents: [{ year: 2030, action: "sell", shares: 600, pct: null, trancheId: null }],
    };
    const sells = buildGrantTimeline(g, HOLD, PSY, FMV).filter((a) => a.kind === "sell");
    expect(sells.map((s) => [s.lotId, s.shares])).toEqual([["t1#seed", 400], ["t1#ex", 200]]);
    expect(sells.reduce((s, a) => s + a.shares, 0)).toBe(600);
  });
});
