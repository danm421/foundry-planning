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
