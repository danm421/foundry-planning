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
          sharesExercised: "0", sharesSold: "0",
          acquiredOn: null, priceAtAcquisition: null,
          exerciseTiming: null, exerciseYear: null,
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
    expect(p.grants[0].grantDate).toBe("2024-04-01");
    expect(p.grants[0].tranches[0].vestDate).toBe("2025-04-01");
    expect(p.grants[0].tranches[0].shares).toBe(250);
    expect(p.grants[0].plannedEvents[0].pct).toBe(0.5);
  });

  it("carries real dates and the stored acquisition through, not years (G8)", () => {
    // The predecessor truncated both dates to a year integer at this boundary,
    // so the statutory holding-period tests downstream could not tell one month
    // from twenty-three. Audit F1/F2/F26/F27.
    const plans = assembleStockOptionPlans({
      extensions: [baseExt],
      grants: [
        {
          id: "g1", accountId: "acct-1", grantNumber: "ISO-1", grantType: "iso",
          grantDate: "2024-06-15", sharesGranted: "100.000000", has83bElection: false,
          fmvAtGrant: "30.0000", strikePrice: "10.0000", strikeDiscountPct: null,
          expirationDate: "2034-06-15",
          exerciseTiming: null, exerciseYear: null, sellTiming: null, sellYear: null,
          sellPercentPerYear: null, sellStartYear: null, sortOrder: 0,
        },
      ],
      tranches: [
        { id: "t1", grantId: "g1", vestDate: "2025-03-01", shares: "100.000000",
          sharesExercised: "100.000000", sharesSold: "0",
          acquiredOn: "2025-11-04", priceAtAcquisition: "42.5000",
          exerciseTiming: null, exerciseYear: null,
          sellTiming: null, sellYear: null, sellPercentPerYear: null, sellStartYear: null, sortOrder: 0 },
      ],
      plannedEvents: [],
      ownerByAccount: {},
      growthByAccount: {},
    });
    const g = plans[0].grants[0];
    expect(g.grantDate).toBe("2024-06-15");
    expect(g.tranches[0].vestDate).toBe("2025-03-01");
    expect(g.tranches[0].acquiredOn).toBe("2025-11-04");
    // Drizzle hands decimals back as STRINGS — `numN`, never `+row.col`.
    expect(g.tranches[0].priceAtAcquisition).toBe(42.5);
    // The expiration is genuinely a year in the engine's strategy layer.
    expect(g.expirationYear).toBe(2034);
  });

  it("leaves a blank acquisition null rather than inventing one", () => {
    const plans = assembleStockOptionPlans({
      extensions: [baseExt],
      grants: [
        {
          id: "g1", accountId: "acct-1", grantNumber: null, grantType: "rsu",
          grantDate: "2024-04-01", sharesGranted: "250.000000", has83bElection: false,
          fmvAtGrant: null, strikePrice: null, strikeDiscountPct: null, expirationDate: null,
          exerciseTiming: null, exerciseYear: null, sellTiming: null, sellYear: null,
          sellPercentPerYear: null, sellStartYear: null, sortOrder: 0,
        },
      ],
      tranches: [
        { id: "t1", grantId: "g1", vestDate: "2025-04-01", shares: "250.000000",
          sharesExercised: "0", sharesSold: "0",
          acquiredOn: null, priceAtAcquisition: null,
          exerciseTiming: null, exerciseYear: null,
          sellTiming: null, sellYear: null, sellPercentPerYear: null, sellStartYear: null, sortOrder: 0 },
      ],
      plannedEvents: [],
      ownerByAccount: {},
      growthByAccount: {},
    });
    expect(plans[0].grants[0].tranches[0].acquiredOn).toBeNull();
    expect(plans[0].grants[0].tranches[0].priceAtAcquisition).toBeNull();
  });

  it("emits no plan for an account with no extension row", () => {
    const plans = assembleStockOptionPlans({
      extensions: [], grants: [], tranches: [], plannedEvents: [],
      ownerByAccount: {}, growthByAccount: {},
    });
    expect(plans).toEqual([]);
  });
});
