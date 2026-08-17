import { describe, it, expect } from "vitest";
import { buildGrantTimeline } from "../timeline";
import type { EquityGrant } from "../types";

const PSY = 2026; // planStartYear
// Share price the timeline consults for moneyness. Every option fixture below
// has a strike well under 100, so all of them stay in the money.
const FMV = () => 100;

function rsu(over: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g1", grantNumber: "RS-1", grantType: "rsu", grantDate: "2024-01-15", sharesGranted: 1000,
    has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
    expirationYear: null, strategy: null,
    tranches: [
      { id: "t1", vestDate: "2025-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 250, sharesExercised: 0, sharesSold: 0, strategy: null },
      { id: "t2", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 250, sharesExercised: 0, sharesSold: 0, strategy: null },
    ],
    plannedEvents: [],
    ...over,
  };
}

describe("buildGrantTimeline — RSU", () => {
  it("seeds an already-vested tranche as held at planStartYear and schedules a future vest as acquire", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(rsu(), acct, PSY, FMV);
    expect(actions).toContainEqual(expect.objectContaining({ year: PSY, kind: "seed_held", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 250 }));
    expect(actions).toContainEqual(expect.objectContaining({ year: 2027, kind: "acquire_rsu", grantId: "g1", trancheId: "t2", lotId: "t2#acq", shares: 250 }));
  });

  it("subtracts already-sold actuals from seeded held shares", () => {
    const g = rsu();
    g.tranches[0].sharesSold = 100;
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    expect(actions).toContainEqual(expect.objectContaining({ year: PSY, kind: "seed_held", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 150 }));
  });

  it("83(b): acquires all granted shares at the grant year (held), no per-tranche acquire", () => {
    const g = rsu({ has83bElection: true, fmvAtGrant: 5, grantDate: "2026-01-15" });
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    expect(actions).toContainEqual(expect.objectContaining({ year: 2026, kind: "acquire_rsu", grantId: "g1", trancheId: "t1", lotId: "t1#acq", shares: 1000 }));
    expect(actions.filter((a) => a.kind === "acquire_rsu")).toHaveLength(1);
  });
});

describe("buildGrantTimeline — NQSO/ISO", () => {
  const optGrant = (): EquityGrant => ({
    id: "g2", grantNumber: "ISO-1", grantType: "iso", grantDate: "2024-01-15", sharesGranted: 400,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2034, strategy: null,
    tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 400, sharesExercised: 0, sharesSold: 0, strategy: null }],
    plannedEvents: [],
  });

  it("at_vest exercises in the vest year and holds", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY, FMV);
    expect(actions).toContainEqual(expect.objectContaining({ year: 2027, kind: "exercise", grantId: "g2", trancheId: "t1", lotId: "t1#ex", shares: 400 }));
  });

  it("year_before_expiration exercises the year before expiry", () => {
    const acct = { exerciseTiming: "year_before_expiration" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY, FMV);
    expect(actions).toContainEqual(expect.objectContaining({ year: 2033, kind: "exercise", grantId: "g2", trancheId: "t1", lotId: "t1#ex", shares: 400 }));
  });

  it("expires unexercised shares at expiration when never exercised (sellTiming hold, exerciseTiming manual, no planned events)", () => {
    const acct = { exerciseTiming: "manual" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY, FMV);
    expect(actions).toContainEqual(expect.objectContaining({ year: 2034, kind: "expire", grantId: "g2", trancheId: "t1", lotId: "t1#ex", shares: 400 }));
  });
});

describe("buildGrantTimeline — sells", () => {
  it("percent_per_year schedules a sell of the remaining held each year from the start year", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "percent_per_year" as const, sellYear: null, sellPercentPerYear: 0.5, sellStartYear: 2026 };
    // single already-vested tranche of 200 held at PSY
    const g = rsu({ tranches: [{ id: "t1", vestDate: "2025-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 200, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const actions = buildGrantTimeline(g, acct, PSY, FMV).filter((a) => a.kind === "sell");
    // 2026 sells 100 (50% of 200), 2027 sells 50 (50% of remaining 100), etc.
    expect(actions[0]).toMatchObject({ year: 2026, kind: "sell", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 100 });
    expect(actions[1]).toMatchObject({ year: 2027, kind: "sell", grantId: "g1", trancheId: "t1", lotId: "t1#seed", shares: 50 });
  });

  it("immediately sells in the same year as acquisition (cashless)", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "immediately" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const g = rsu({ tranches: [{ id: "t1", vestDate: "2028-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 300, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const actions = buildGrantTimeline(g, acct, PSY, FMV);
    expect(actions).toContainEqual(expect.objectContaining({ year: 2028, kind: "acquire_rsu", grantId: "g1", trancheId: "t1", lotId: "t1#acq", shares: 300 }));
    expect(actions).toContainEqual(expect.objectContaining({ year: 2028, kind: "sell", grantId: "g1", trancheId: "t1", lotId: "t1#acq", shares: 300 }));
  });
});

describe("buildGrantTimeline — options that should never be exercised", () => {
  const lapsed = (): EquityGrant => ({
    id: "g3", grantNumber: "NQ-OLD", grantType: "nqso", grantDate: "2018-01-15", sharesGranted: 5000,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2025, strategy: null, // expired BEFORE the plan starts
    tranches: [{ id: "t1", vestDate: "2020-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 5000, sharesExercised: 0, sharesSold: 0, strategy: null }],
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
    expect(actions).toContainEqual(expect.objectContaining({ year: PSY, kind: "exercise", grantId: "g3", trancheId: "t1", lotId: "t1#ex", shares: 5000 }));
  });

  it("does not exercise an option that is out of the money", () => {
    // 1,000 shares, $100 strike, $50 share price: exercising spends $100,000 to
    // buy $50,000 of stock. Exercisability was decided from dates alone.
    const g: EquityGrant = {
      id: "g4", grantNumber: "NQ-UW", grantType: "nqso", grantDate: "2024-01-15", sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 100, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null,
      tranches: [{ id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null }],
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
      id: "g5", grantNumber: "NQ-SPLIT", grantType: "nqso", grantDate: "2024-01-15", sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null,
      tranches: [{ id: "t1", vestDate: "2025-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 400, sharesSold: 0, strategy: null }],
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
      id: "gpe", grantNumber: "RS-PE", grantType: "rsu", grantDate: "2025-01-15", sharesGranted: 4000,
      has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null,
      tranches: [2027, 2028, 2029, 2030].map((y, i) => ({
        id: `t${i + 1}`, vestDate: `${y}-01-15`, acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null,
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
      id: "gord", grantNumber: "RS-ORD", grantType: "rsu", grantDate: "2025-01-15", sharesGranted: 2000,
      has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null,
      tranches: [
        { id: "t1", vestDate: "2027-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "t2", vestDate: "2035-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
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
      id: "gpe2", grantNumber: "NQ-PE", grantType: "nqso", grantDate: "2024-01-15", sharesGranted: 1000,
      has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
      expirationYear: 2034, strategy: null,
      tranches: [{ id: "t1", vestDate: "2025-01-15", acquiredOn: null, priceAtAcquisition: null, shares: 1000, sharesExercised: 400, sharesSold: 0, strategy: null }],
      plannedEvents: [{ year: 2030, action: "sell", shares: 600, pct: null, trancheId: null }],
    };
    const sells = buildGrantTimeline(g, HOLD, PSY, FMV).filter((a) => a.kind === "sell");
    expect(sells.map((s) => [s.lotId, s.shares])).toEqual([["t1#seed", 400], ["t1#ex", 200]]);
    expect(sells.reduce((s, a) => s + a.shares, 0)).toBe(600);
  });
});

describe("action dates (G8)", () => {
  const HOLD = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };

  /** One option grant, one row, so each test varies exactly one thing. */
  const opt = (over: Partial<EquityGrant> = {}, tr: Partial<EquityGrant["tranches"][0]> = {}): EquityGrant => ({
    id: "gd", grantNumber: "OPT-D", grantType: "nqso", grantDate: "2024-02-01", sharesGranted: 100,
    has83bElection: false, fmvAtGrant: null, strikePrice: 10, strikeDiscountPct: null,
    expirationYear: 2034, strategy: null,
    tranches: [{
      id: "t1", vestDate: "2027-03-15", shares: 100, sharesExercised: 0, sharesSold: 0,
      acquiredOn: null, priceAtAcquisition: null, strategy: null, ...tr,
    }],
    plannedEvents: [],
    // `over` LAST so a caller's grantDate/strategy actually wins. Omitting this
    // spread made every override a silent no-op and three tests measured the
    // default instead of the thing they named.
    ...over,
  });

  it("dates an at-vest exercise on the real vest date, not 1 January", () => {
    const acts = buildGrantTimeline(opt(), HOLD, PSY, FMV);
    expect(acts.find((a) => a.kind === "exercise")!.date).toBe("2027-03-15");
  });

  it("dates a later exercise on the vest anniversary in the chosen year", () => {
    const g = opt({ strategy: { exerciseTiming: "specific_year", exerciseYear: 2030 } });
    const acts = buildGrantTimeline(g, HOLD, PSY, FMV);
    expect(acts.find((a) => a.kind === "exercise")!.date).toBe("2030-03-15");
  });

  it("dates a modeled sale on 31 December of the sell year", () => {
    const g = opt({ strategy: { exerciseTiming: "at_vest", sellTiming: "hold_then_sell_year", sellYear: 2031 } });
    const acts = buildGrantTimeline(g, HOLD, PSY, FMV);
    expect(acts.find((a) => a.kind === "sell")!.date).toBe("2031-12-31");
  });

  it("pulls a sale year back to the acquisition year, so a sale never precedes its lot", () => {
    // Exercise is forced to 2030; a sellYear of 2028 cannot come first.
    const g = opt({ strategy: { exerciseTiming: "specific_year", exerciseYear: 2030, sellTiming: "hold_then_sell_year", sellYear: 2028 } });
    const acts = buildGrantTimeline(g, HOLD, PSY, FMV);
    const ex = acts.find((a) => a.kind === "exercise")!;
    const sell = acts.find((a) => a.kind === "sell")!;
    expect(ex.date).toBe("2030-03-15");
    expect(sell.date).toBe("2030-12-31");
  });

  it("floors the sale DATE at the lot's own date when the stored acquisition outruns the sell year", () => {
    // The year-level `Math.max` is not enough on its own. A `seed_held` action is
    // MODELED in the first plan year but carries the REAL stored acquisition
    // date, and nothing stops an advisor entering one later than the sale year's
    // 31 December — a mistyped year, or a grant whose confirmation is dated
    // ahead. Without the date floor the sale reads as happening four years
    // BEFORE the shares were acquired, i.e. a negative holding period, which
    // `isLongTermHolding` would answer honestly and uselessly.
    const g = opt(
      { grantDate: "2023-02-01", strategy: { sellTiming: "immediately" } },
      { vestDate: "2024-03-15", sharesExercised: 100, acquiredOn: "2030-05-01", priceAtAcquisition: 42 },
    );
    const acts = buildGrantTimeline(g, HOLD, PSY, FMV);
    const seed = acts.find((a) => a.kind === "seed_held")!;
    const sell = acts.find((a) => a.kind === "sell")!;
    expect(seed.date).toBe("2030-05-01");
    expect(sell.year).toBe(2026); // still modeled in the first plan year
    expect(sell.date).toBe("2030-05-01"); // floored, NOT "2026-12-31"
  });

  it("seeds a pre-plan lot on its REAL acquisition date when one is stored", () => {
    const g = opt(
      { grantDate: "2023-02-01" },
      { vestDate: "2024-03-15", sharesExercised: 100, acquiredOn: "2025-11-04", priceAtAcquisition: 42 },
    );
    const seed = buildGrantTimeline(g, HOLD, PSY, FMV).find((a) => a.kind === "seed_held")!;
    expect(seed.date).toBe("2025-11-04");
    expect(seed.priceAtAcquisition).toBe(42);
    expect(seed.year).toBe(2026); // still MODELED in the first plan year
  });

  it("falls back to the plan start date — zero days held — when no acquisition date is stored", () => {
    const g = opt(
      { grantDate: "2023-02-01" },
      { vestDate: "2024-03-15", sharesExercised: 100 },
    );
    const seed = buildGrantTimeline(g, HOLD, PSY, FMV).find((a) => a.kind === "seed_held")!;
    expect(seed.date).toBe("2026-01-01");
  });

  it("drops a price that arrives without a date — a half-entered fact never applies", () => {
    const g = opt(
      { grantDate: "2023-02-01" },
      { vestDate: "2024-03-15", sharesExercised: 100, acquiredOn: null, priceAtAcquisition: 42 },
    );
    const seed = buildGrantTimeline(g, HOLD, PSY, FMV).find((a) => a.kind === "seed_held")!;
    expect(seed.date).toBe("2026-01-01");
    expect(seed.priceAtAcquisition).toBeNull();
  });

  it("dates an 83(b) acquisition at GRANT, which is when its holding period starts", () => {
    const g: EquityGrant = {
      id: "g83", grantNumber: "RS-83B", grantType: "rsu", grantDate: "2027-06-10", sharesGranted: 500,
      has83bElection: true, fmvAtGrant: 5, strikePrice: null, strikeDiscountPct: null,
      expirationYear: null, strategy: null,
      tranches: [{ id: "t1", vestDate: "2029-06-10", shares: 500, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null }],
      plannedEvents: [],
    };
    const acq = buildGrantTimeline(g, HOLD, PSY, FMV).find((a) => a.kind === "acquire_rsu")!;
    expect(acq.date).toBe("2027-06-10");
  });

  it("dates an in-plan RSU vest on the real vest date", () => {
    const g = rsu({ tranches: [{ id: "t1", vestDate: "2028-09-30", shares: 300, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null }] });
    const acq = buildGrantTimeline(g, HOLD, PSY, FMV).find((a) => a.kind === "acquire_rsu")!;
    expect(acq.date).toBe("2028-09-30");
  });
});
