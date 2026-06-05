import { describe, it, expect } from "vitest";
import { assembleStockOptionPlans } from "../load-equity";

const baseExt = {
  accountId: "acct-1",
  ticker: "ACME",
  isPublic: true,
  pricePerShare: "100.0000",
  destinationAccountId: null,
  autoCreateDestination: true,
  sellToCover: true,
  withholdingRate: "0.2200",
  defaultExerciseTiming: "at_vest" as const,
  defaultExerciseYear: null,
  defaultSellTiming: "hold" as const,
  defaultSellYear: null,
  defaultSellPercentPerYear: null,
  defaultSellStartYear: null,
};

describe("assembleStockOptionPlans", () => {
  it("nests grants + tranches + planned events under their account and parses decimals", () => {
    const plans = assembleStockOptionPlans({
      extensions: [baseExt],
      grants: [
        {
          id: "g1", accountId: "acct-1", grantNumber: "RS-1", grantType: "rsu",
          grantDate: "2024-04-01", sharesGranted: "1000.000000", has83bElection: false,
          fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null, expirationDate: null,
          exerciseTiming: null, exerciseYear: null, sellTiming: null, sellYear: null,
          sellPercentPerYear: null, sellStartYear: null, sortOrder: 0,
        },
      ],
      tranches: [
        { id: "t1", grantId: "g1", vestDate: "2025-04-01", shares: "250.000000",
          sharesExercised: "0", sharesSold: "0", exerciseTiming: null, exerciseYear: null,
          sellTiming: null, sellYear: null, sellPercentPerYear: null, sellStartYear: null, sortOrder: 0 },
      ],
      plannedEvents: [
        { id: "p1", grantId: "g1", trancheId: null, year: 2027, action: "sell", shares: null, pct: "0.5000" },
      ],
      ownerByAccount: { "acct-1": "client" },
      growthByAccount: { "acct-1": 0.07 },
    });

    expect(plans).toHaveLength(1);
    const p = plans[0];
    expect(p.pricePerShare).toBe(100);
    expect(p.withholdingRate).toBe(0.22);
    expect(p.strategy.exerciseTiming).toBe("at_vest");
    expect(p.growthRate).toBe(0.07);
    expect(p.grants[0].grantType).toBe("rsu");
    expect(p.grants[0].grantYear).toBe(2024);
    expect(p.grants[0].tranches[0].vestYear).toBe(2025);
    expect(p.grants[0].tranches[0].shares).toBe(250);
    expect(p.grants[0].plannedEvents[0].pct).toBe(0.5);
  });

  it("emits no plan for an account with no extension row", () => {
    const plans = assembleStockOptionPlans({
      extensions: [], grants: [], tranches: [], plannedEvents: [],
      ownerByAccount: {}, growthByAccount: {},
    });
    expect(plans).toEqual([]);
  });
});
