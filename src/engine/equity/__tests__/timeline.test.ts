import { describe, it, expect } from "vitest";
import { buildGrantTimeline } from "../timeline";
import type { EquityGrant } from "../types";

const PSY = 2026; // planStartYear

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
    const actions = buildGrantTimeline(rsu(), acct, PSY);
    expect(actions).toContainEqual({ year: PSY, kind: "seed_held", grantId: "g1", trancheId: "t1", shares: 250 });
    expect(actions).toContainEqual({ year: 2027, kind: "acquire_rsu", grantId: "g1", trancheId: "t2", shares: 250 });
  });

  it("subtracts already-sold actuals from seeded held shares", () => {
    const g = rsu();
    g.tranches[0].sharesSold = 100;
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY);
    expect(actions).toContainEqual({ year: PSY, kind: "seed_held", grantId: "g1", trancheId: "t1", shares: 150 });
  });

  it("83(b): acquires all granted shares at the grant year (held), no per-tranche acquire", () => {
    const g = rsu({ has83bElection: true, fmvAtGrant: 5, grantYear: 2026 });
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(g, acct, PSY);
    expect(actions).toContainEqual({ year: 2026, kind: "acquire_rsu", grantId: "g1", trancheId: "t1", shares: 1000 });
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
    const actions = buildGrantTimeline(optGrant(), acct, PSY);
    expect(actions).toContainEqual({ year: 2027, kind: "exercise", grantId: "g2", trancheId: "t1", shares: 400 });
  });

  it("year_before_expiration exercises the year before expiry", () => {
    const acct = { exerciseTiming: "year_before_expiration" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY);
    expect(actions).toContainEqual({ year: 2033, kind: "exercise", grantId: "g2", trancheId: "t1", shares: 400 });
  });

  it("expires unexercised shares at expiration when never exercised (sellTiming hold, exerciseTiming manual, no planned events)", () => {
    const acct = { exerciseTiming: "manual" as const, exerciseYear: null, sellTiming: "hold" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const actions = buildGrantTimeline(optGrant(), acct, PSY);
    expect(actions).toContainEqual({ year: 2034, kind: "expire", grantId: "g2", trancheId: "t1", shares: 400 });
  });
});

describe("buildGrantTimeline — sells", () => {
  it("percent_per_year schedules a sell of the remaining held each year from the start year", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "percent_per_year" as const, sellYear: null, sellPercentPerYear: 0.5, sellStartYear: 2026 };
    // single already-vested tranche of 200 held at PSY
    const g = rsu({ tranches: [{ id: "t1", vestYear: 2025, shares: 200, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const actions = buildGrantTimeline(g, acct, PSY).filter((a) => a.kind === "sell");
    // 2026 sells 100 (50% of 200), 2027 sells 50 (50% of remaining 100), etc.
    expect(actions[0]).toEqual({ year: 2026, kind: "sell", grantId: "g1", trancheId: "t1", shares: 100 });
    expect(actions[1]).toEqual({ year: 2027, kind: "sell", grantId: "g1", trancheId: "t1", shares: 50 });
  });

  it("immediately sells in the same year as acquisition (cashless)", () => {
    const acct = { exerciseTiming: "at_vest" as const, exerciseYear: null, sellTiming: "immediately" as const, sellYear: null, sellPercentPerYear: null, sellStartYear: null };
    const g = rsu({ tranches: [{ id: "t1", vestYear: 2028, shares: 300, sharesExercised: 0, sharesSold: 0, strategy: null }] });
    const actions = buildGrantTimeline(g, acct, PSY);
    expect(actions).toContainEqual({ year: 2028, kind: "acquire_rsu", grantId: "g1", trancheId: "t1", shares: 300 });
    expect(actions).toContainEqual({ year: 2028, kind: "sell", grantId: "g1", trancheId: "t1", shares: 300 });
  });
});
