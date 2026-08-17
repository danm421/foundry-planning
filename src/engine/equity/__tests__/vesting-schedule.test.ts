import { describe, it, expect } from "vitest";
import { buildVestingSchedule } from "../vesting-schedule";
import { isQualifyingIsoDisposition, assumedPrePlanAcquisitionYear } from "../holding-period";
import { createEquityState, computeEquityYear } from "../tax-events";
import { buildFutureActivity } from "../future-activity";
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

  it("an explicit strike is one number and carries no range", () => {
    const row = buildVestingSchedule([nqsoPlan()], { asOfYear: 2026, planStartYear: 2026 }).rows[0];
    expect(row.strike).toBe(25);
    expect(row.strikeHigh).toBeNull();
  });
});

// ── Audit F36 ────────────────────────────────────────────────────────────────
// A grant priced by DISCOUNT has no strike until an exercise year is known:
// resolveStrikePrice reads the discount off the FMV *in the exercise year*. The
// schedule used to resolve it against the plan-start FMV while the Future
// Activity ledger printed the engine's exercise-year number — $42.50 here
// against $59.61 there, for the same grant.

function discountPlan(vestYears: number[]): StockOptionPlan {
  return basePlan({
    accountId: "acct-disc",
    pricePerShare: 50,
    growthRate: 0.07,
    strategy: { ...EMPTY_STRATEGY, exerciseTiming: "at_vest", sellTiming: "hold" },
    grants: [{
      id: "g-disc", grantNumber: "DISC-1", grantType: "nqso", grantYear: 2026,
      sharesGranted: 1000 * vestYears.length, has83bElection: false, fmvAtGrant: null,
      strikePrice: null, strikeDiscountPct: 0.15, expirationYear: 2040,
      strategy: { ...EMPTY_STRATEGY },
      tranches: vestYears.map((vestYear, i) => ({
        id: `d${i}`, vestYear, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null,
      })),
      plannedEvents: [],
    }],
  });
}

describe("buildVestingSchedule — discount-priced strike (F36)", () => {
  it("prints the strike the ledger will actually charge, not today's", () => {
    const p = discountPlan([2031]);
    const row = buildVestingSchedule([p], { asOfYear: 2026, planStartYear: 2026 }).rows[0];
    const ledger = buildFutureActivity([p], { asOfYear: 2026, planStartYear: 2026, planEndYear: 2040 })
      .groups.flatMap((g) => g.rows).find((r) => r.sharesExercised > 0)!;

    expect(ledger.exercisePrice).toBeCloseTo(59.61, 2); // 50 × 1.07^5 × 0.85
    expect(row.strike).toBeCloseTo(ledger.exercisePrice!, 6);
    expect(row.strikeHigh).toBeNull();
    // …and it is NOT the old plan-start number, which is a full $17 lower.
    expect(row.strike).not.toBeCloseTo(42.5, 2);
  });

  it("reports a range when the plan exercises across several years", () => {
    const p = discountPlan([2028, 2031]);
    const row = buildVestingSchedule([p], { asOfYear: 2026, planStartYear: 2026 }).rows[0];
    const prices = buildFutureActivity([p], { asOfYear: 2026, planStartYear: 2026, planEndYear: 2040 })
      .groups.flatMap((g) => g.rows).filter((r) => r.sharesExercised > 0).map((r) => r.exercisePrice!);

    expect(prices).toHaveLength(2);
    expect(row.strike).toBeCloseTo(Math.min(...prices), 6);
    expect(row.strikeHigh).toBeCloseTo(Math.max(...prices), 6);
    expect(row.strikeHigh!).toBeGreaterThan(row.strike!);
  });

  it("falls back to the plan-start price when the plan never exercises the grant", () => {
    // Out of the money forever: a 0% discount makes strike == FMV every year,
    // so exerciseYearFor refuses and there is no ledger number to agree with.
    const p = discountPlan([2031]);
    p.grants[0].strikeDiscountPct = 0;
    const row = buildVestingSchedule([p], { asOfYear: 2026, planStartYear: 2026 }).rows[0];
    expect(buildFutureActivity([p], { asOfYear: 2026, planStartYear: 2026, planEndYear: 2040 })
      .groups.flatMap((g) => g.rows).filter((r) => r.sharesExercised > 0)).toHaveLength(0);
    expect(row.strike).toBe(50);
    expect(row.strikeHigh).toBeNull();
  });
});

function isoPlan(): StockOptionPlan {
  return basePlan({
    accountId: "acct-iso",
    grants: [
      { // OLD grant → exercised shares are past the holding period (qualified)
        id: "g-iso-old", grantNumber: "ACME ISO old", grantType: "iso", grantYear: 2021,
        sharesGranted: 3000, has83bElection: false, fmvAtGrant: null,
        strikePrice: 12, strikeDiscountPct: null, expirationYear: 2031,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "o1", vestYear: 2022, shares: 3000, sharesExercised: 3000, sharesSold: 0, strategy: null },
        ],
        plannedEvents: [],
      },
      { // RECENT grant → grantYear+2 (2027) > asOf (2026), still in holding window
        id: "g-iso-new", grantNumber: "ACME ISO new", grantType: "iso", grantYear: 2025,
        sharesGranted: 4000, has83bElection: false, fmvAtGrant: null,
        strikePrice: 12, strikeDiscountPct: null, expirationYear: 2035,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "o2", vestYear: 2025, shares: 4000, sharesExercised: 4000, sharesSold: 0, strategy: null },
        ],
        plannedEvents: [],
      },
    ],
  });
}

describe("buildVestingSchedule — ISO qualification", () => {
  it("splits exercised ISO shares into qualified vs holding", () => {
    const model = buildVestingSchedule([isoPlan()], { asOfYear: 2026, planStartYear: 2026 });
    const [oldRow, newRow] = model.rows;

    // Shares already exercised are seeded at assumedPrePlanAcquisitionYear
    // (2024), so the exercise leg clears at once and the grant leg decides.
    // old: 2026 − 2021 = 5 ≥ 3 → all qualified
    expect(oldRow.isoSplit).toEqual({ qualified: 3000, holding: 0 });
    // new: 2026 − 2025 = 1 < 3 → all still in the window
    expect(newRow.isoSplit).toEqual({ qualified: 0, holding: 4000 });
  });

  it("turns qualified exactly where isQualifyingIsoDisposition does, not a year early", () => {
    // The grant leg is the binding one: qualified from grantYear + 3.
    // 2023 grant → qualified in 2026; 2024 grant → not until 2027. Before
    // audit F17/F47 this screen used max(grantYear + 2, vestYear + 1) and
    // flipped a full year sooner than the tax ledger.
    const at = (grantYear: number, asOfYear: number) => {
      const p = isoPlan();
      p.grants = [p.grants[0]];
      p.grants[0].grantYear = grantYear;
      p.grants[0].tranches[0].vestYear = grantYear + 1;
      return buildVestingSchedule([p], { asOfYear, planStartYear: 2026 }).rows[0].isoSplit;
    };
    expect(at(2023, 2026)).toEqual({ qualified: 3000, holding: 0 });
    expect(at(2024, 2026)).toEqual({ qualified: 0, holding: 3000 });
    // …and the same rule, called directly, agrees. If isoSplitFor ever stops
    // routing through the shared helper this pair stops matching.
    expect(isQualifyingIsoDisposition({
      grantYear: 2023, exerciseYear: assumedPrePlanAcquisitionYear(2026), dispositionYear: 2026,
    })).toBe(true);
    expect(isQualifyingIsoDisposition({
      grantYear: 2024, exerciseYear: assumedPrePlanAcquisitionYear(2026), dispositionYear: 2026,
    })).toBe(false);
  });

  it("the badge matches the branch the tax ledger takes on the same grant", () => {
    // The cross-surface check audit F17/F47 asked for: an ISO priced by
    // discount has a real bargain element, so the ledger's two branches are
    // distinguishable in dollars — qualified books capital gain, disqualifying
    // books ordinary income.
    const mk = (grantYear: number): StockOptionPlan => ({
      ...basePlan({ accountId: "acct-x" }),
      pricePerShare: 100,
      growthRate: 0,
      grants: [{
        id: "g", grantNumber: "ISO", grantType: "iso", grantYear, sharesGranted: 1000,
        has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: 0.15,
        expirationYear: 2036, strategy: { sellTiming: "hold_then_sell_year", sellYear: 2026 },
        tranches: [{ id: "t", vestYear: grantYear, shares: 1000, sharesExercised: 1000, sharesSold: 0, strategy: null }],
        plannedEvents: [],
      }],
    });
    for (const [grantYear, expectQualified] of [[2023, true], [2024, false]] as const) {
      const p = mk(grantYear);
      const badge = buildVestingSchedule([p], { asOfYear: 2026, planStartYear: 2026 }).rows[0].isoSplit;
      const r = computeEquityYear(p, createEquityState([p], 2026), 2026);
      expect(r.sellProceeds).toBeGreaterThan(0); // the sale really happened
      expect((badge?.qualified ?? 0) > 0).toBe(expectQualified);
      // Badge says qualified ⟺ ledger books no ordinary income on the sale.
      expect(r.ordinaryIncome === 0).toBe(expectQualified);
    }
  });

  it("returns null isoSplit for NQSO/RSU and for ISO with nothing exercised", () => {
    expect(buildVestingSchedule([nqsoPlan()], { asOfYear: 2026, planStartYear: 2026 }).rows[0].isoSplit).toBeNull();
    expect(buildVestingSchedule([rsuPlan()], { asOfYear: 2026, planStartYear: 2026 }).rows[0].isoSplit).toBeNull();
    const noEx = isoPlan();
    noEx.grants[0].tranches[0].sharesExercised = 0;
    noEx.grants[1].tranches[0].sharesExercised = 0;
    const m = buildVestingSchedule([noEx], { asOfYear: 2026, planStartYear: 2026 });
    expect(m.rows[0].isoSplit).toBeNull();
    expect(m.rows[1].isoSplit).toBeNull();
  });
});

describe("buildVestingSchedule — edge cases", () => {
  it("treats an 83(b) RSU as fully vested with no future columns", () => {
    const plan = basePlan({
      accountId: "acct-83b",
      grants: [{
        id: "g-83b", grantNumber: "ACME 83b", grantType: "rsu", grantYear: 2025,
        sharesGranted: 2000, has83bElection: true, fmvAtGrant: 10,
        strikePrice: null, strikeDiscountPct: null, expirationYear: null,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "b1", vestYear: 2026, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
          { id: "b2", vestYear: 2027, shares: 1000, sharesExercised: 0, sharesSold: 0, strategy: null },
        ],
        plannedEvents: [],
      }],
    });
    const row = buildVestingSchedule([plan], { asOfYear: 2026, planStartYear: 2026 }).rows[0];
    expect(row.vested).toBe(2000);
    expect(row.unvested).toBe(0);
    expect(row.futureByYear).toEqual([0, 0, 0, 0]);
    expect(row.futurePlus).toBe(0);
  });

  it("returns an empty model for no plans", () => {
    const model = buildVestingSchedule([], { asOfYear: 2026, planStartYear: 2026 });
    expect(model.rows).toEqual([]);
    expect(model.yearColumns).toEqual([2026, 2027, 2028, 2029]);
    expect(model.plusLabel).toBeNull();
    expect(model.totals.granted).toBe(0);
  });
});
