import { describe, it, expect } from "vitest";
import { createEquityState, computeEquityYear } from "../tax-events";
import type { StockOptionPlan, EquityGrant, EquityStrategy } from "../types";

const HOLD: EquityStrategy = {
  exerciseTiming: "at_vest", exerciseYear: null,
  sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null,
};

function plan(grants: EquityGrant[], over: Partial<StockOptionPlan> = {}): StockOptionPlan {
  return {
    accountId: "acct1", ticker: "ACME", pricePerShare: 100, growthRate: 0,
    destinationAccountId: "dest", autoCreateDestination: false,
    sellToCover: true, withholdingRate: 0.25, strategy: HOLD, owner: "client", grants, ...over,
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

describe("computeEquityYear — details[]", () => {
  it("emits a vest detail carrying cover shares + proceeds", () => {
    const p = plan([rsu()]);
    const st = createEquityState([p], 2026);
    const res = computeEquityYear(p, st, 2027);
    const vest = res.details.find((d) => d.kind === "vest");
    expect(vest).toBeTruthy();
    expect(vest!.shares).toBe(100);
    expect(vest!.coverShares).toBeCloseTo(25, 6); // 100*100*0.25/100
    expect(vest!.proceeds).toBeCloseTo(2500, 6);
    expect(vest!.exerciseCost).toBe(0);
  });

  it("emits no detail in a year with no actions", () => {
    const p = plan([rsu()]);
    const st = createEquityState([p], 2026);
    expect(computeEquityYear(p, st, 2026).details).toEqual([]);
  });
});
