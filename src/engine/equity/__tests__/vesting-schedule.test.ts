import { describe, it, expect } from "vitest";
import { buildVestingSchedule } from "../vesting-schedule";
import type { StockOptionPlan } from "../types";

const EMPTY_STRATEGY = {
  exerciseTiming: null, exerciseYear: null, sellTiming: null,
  sellYear: null, sellPercentPerYear: null, sellStartYear: null,
};

function basePlan(overrides: Partial<StockOptionPlan> = {}): StockOptionPlan {
  return {
    accountId: "acct-1", ticker: "ACME", pricePerShare: 70, growthRate: 0,
    destinationAccountId: null, autoCreateDestination: true, sellToCover: true,
    withholdingRate: 0.22, owner: "client", strategy: { ...EMPTY_STRATEGY },
    grants: [], ...overrides,
  };
}

function rsuPlan(): StockOptionPlan {
  return basePlan({
    grants: [{
      id: "g-rsu", grantNumber: "ACME 2023", grantType: "rsu", grantYear: 2023,
      sharesGranted: 4000, has83bElection: false, fmvAtGrant: null,
      strikePrice: null, strikeDiscountPct: null, expirationYear: null,
      strategy: { ...EMPTY_STRATEGY },
      tranches: [
        { id: "t1", vestYear: 2024, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "t2", vestYear: 2025, shares: 1000, sharesExercised: 0, sharesSold: 800, strategy: null },
        { id: "t3", vestYear: 2026, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "t4", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
      ],
      plannedEvents: [],
    }],
  });
}

describe("buildVestingSchedule — RSU", () => {
  it("splits vested vs upcoming vesting by year, with value and totals", () => {
    const model = buildVestingSchedule([rsuPlan()], {
      asOfYear: 2026, planStartYear: 2026, futureYearCount: 4,
    });

    expect(model.yearColumns).toEqual([2026, 2027, 2028, 2029]);
    expect(model.plusLabel).toBeNull();

    const row = model.rows[0];
    expect(row.label).toBe("ACME 2023");
    expect(row.isOption).toBe(false);
    expect(row.granted).toBe(4000);
    expect(row.vested).toBe(2000);            // vestYear < 2026 → 2024 + 2025
    expect(row.unvested).toBe(2000);          // 2026 + 2027
    expect(row.futureByYear).toEqual([1000, 1000, 0, 0]);
    expect(row.futurePlus).toBe(0);
    expect(row.sold).toBe(800);
    expect(row.exercisable).toBeNull();
    expect(row.exercised).toBeNull();
    expect(row.isoSplit).toBeNull();
    expect(row.strike).toBeNull();
    // growth 0 → FMV stays 70; RSU value per share = FMV
    expect(row.estValueByYear).toEqual([70000, 70000, 0, 0]);
    expect(row.estValuePlus).toBe(0);

    expect(model.totals.granted).toBe(4000);
    expect(model.totals.vested).toBe(2000);
    expect(model.totals.futureByYear).toEqual([1000, 1000, 0, 0]);
    expect(model.totals.estValueByYear).toEqual([70000, 70000, 0, 0]);
  });

  it("collapses vesting beyond the discrete columns into the plus bucket", () => {
    const plan = rsuPlan();
    plan.grants[0].sharesGranted = 4500;
    plan.grants[0].tranches.push(
      { id: "t5", vestYear: 2031, shares: 500, sharesExercised: 0, sharesSold: 0, strategy: null },
    );
    const model = buildVestingSchedule([plan], { asOfYear: 2026, planStartYear: 2026, futureYearCount: 4 });
    expect(model.plusLabel).toBe("2030+");
    expect(model.rows[0].futurePlus).toBe(500);
    expect(model.rows[0].estValuePlus).toBe(35000); // 500 * 70
  });
});

function nqsoPlan(): StockOptionPlan {
  return basePlan({
    accountId: "acct-nqso",
    grants: [{
      id: "g-nqso", grantNumber: "ACME 2024", grantType: "nqso", grantYear: 2024,
      sharesGranted: 6000, has83bElection: false, fmvAtGrant: null,
      strikePrice: 25, strikeDiscountPct: null, expirationYear: 2034,
      strategy: { ...EMPTY_STRATEGY },
      tranches: [
        { id: "n1", vestYear: 2025, shares: 1500, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "n2", vestYear: 2026, shares: 1500, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "n3", vestYear: 2027, shares: 1500, sharesExercised: 0, sharesSold: 0, strategy: null },
        { id: "n4", vestYear: 2028, shares: 1500, sharesExercised: 0, sharesSold: 0, strategy: null },
      ],
      plannedEvents: [],
    }],
  });
}

describe("buildVestingSchedule — options (NQSO)", () => {
  it("computes exercisable/exercised/strike/expiration and intrinsic value", () => {
    const model = buildVestingSchedule([nqsoPlan()], { asOfYear: 2026, planStartYear: 2026, futureYearCount: 4 });
    const row = model.rows[0];
    expect(row.isOption).toBe(true);
    expect(row.strike).toBe(25);
    expect(row.expirationYear).toBe(2034);
    expect(row.vested).toBe(1500);        // only 2025 (< 2026)
    expect(row.exercised).toBe(0);
    expect(row.exercisable).toBe(1500);   // vested - exercised
    expect(row.futureByYear).toEqual([1500, 1500, 1500, 0]); // 2026, 2027, 2028
    expect(row.unvested).toBe(4500);
    // intrinsic value at growth 0: FMV 70 - strike 25 = 45/sh; 2026 col = 1500 * 45
    expect(row.estValueByYear).toEqual([67500, 67500, 67500, 0]);
  });

  it("clamps exercisable to zero when exercised exceeds vested", () => {
    const plan = nqsoPlan();
    plan.grants[0].tranches[0].sharesExercised = 9999; // nonsense > vested
    const row = buildVestingSchedule([plan], { asOfYear: 2026, planStartYear: 2026 }).rows[0];
    expect(row.exercisable).toBe(0);
  });
});
