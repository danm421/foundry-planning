import { describe, it, expect } from "vitest";
import { buildVestingSchedule } from "../vesting-schedule";
import { isQualifyingIsoDisposition } from "../holding-period";
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
      id: "g-rsu", grantNumber: "ACME 2023", grantType: "rsu", grantDate: "2023-01-15",
      sharesGranted: 4000, has83bElection: false, fmvAtGrant: null,
      strikePrice: null, strikeDiscountPct: null, expirationYear: null,
      strategy: { ...EMPTY_STRATEGY },
      tranches: [
        { id: "t1", vestDate: "2024-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        { id: "t2", vestDate: "2025-01-15", shares: 1000, sharesExercised: 0, sharesSold: 800, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        { id: "t3", vestDate: "2026-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        { id: "t4", vestDate: "2027-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
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
      { id: "t5", vestDate: "2031-01-15", shares: 500, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
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
      id: "g-nqso", grantNumber: "ACME 2024", grantType: "nqso", grantDate: "2024-01-15",
      sharesGranted: 6000, has83bElection: false, fmvAtGrant: null,
      strikePrice: 25, strikeDiscountPct: null, expirationYear: 2034,
      strategy: { ...EMPTY_STRATEGY },
      tranches: [
        { id: "n1", vestDate: "2025-01-15", shares: 1500, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        { id: "n2", vestDate: "2026-01-15", shares: 1500, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        { id: "n3", vestDate: "2027-01-15", shares: 1500, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        { id: "n4", vestDate: "2028-01-15", shares: 1500, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
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
      id: "g-disc", grantNumber: "DISC-1", grantType: "nqso", grantDate: "2026-01-15",
      sharesGranted: 1000 * vestYears.length, has83bElection: false, fmvAtGrant: null,
      strikePrice: null, strikeDiscountPct: 0.15, expirationYear: 2040,
      strategy: { ...EMPTY_STRATEGY },
      tranches: vestYears.map((vestYear, i) => ({
        id: `d${i}`, vestDate: `${vestYear}-01-15`, shares: 1000, sharesExercised: 0, sharesSold: 0,
        acquiredOn: null, priceAtAcquisition: null, strategy: null,
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
      { // OLD grant, exercised long ago → both §422(a)(1) legs clear (qualified)
        id: "g-iso-old", grantNumber: "ACME ISO old", grantType: "iso", grantDate: "2021-03-01",
        sharesGranted: 3000, has83bElection: false, fmvAtGrant: null,
        strikePrice: 12, strikeDiscountPct: null, expirationYear: 2031,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "o1", vestDate: "2022-03-01", shares: 3000, sharesExercised: 3000, sharesSold: 0,
            acquiredOn: "2022-05-01", priceAtAcquisition: 20, strategy: null },
        ],
        plannedEvents: [],
      },
      { // RECENT grant → the grant leg needs 2027, so it is still holding in 2026
        id: "g-iso-new", grantNumber: "ACME ISO new", grantType: "iso", grantDate: "2025-03-01",
        sharesGranted: 4000, has83bElection: false, fmvAtGrant: null,
        strikePrice: 12, strikeDiscountPct: null, expirationYear: 2035,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "o2", vestDate: "2025-03-01", shares: 4000, sharesExercised: 4000, sharesSold: 0,
            acquiredOn: "2025-06-01", priceAtAcquisition: 40, strategy: null },
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

    // Both legs read the row's STORED exercise date. old: granted 2021-03-01,
    // exercised 2022-05-01 — clear by miles.
    expect(oldRow.isoSplit).toEqual({ qualified: 3000, holding: 0 });
    // new: granted 2025-03-01, so the two-year leg does not clear until 2027.
    expect(newRow.isoSplit).toEqual({ qualified: 0, holding: 4000 });
  });

  it("splits ONE grant's exercised shares across BOTH buckets on real dates", () => {
    // G7 left this loop invariant — the exercise date was assumed identical for
    // every row of a grant, so one bucket was always zero and the badge read
    // "✓2,000 qual · ⧖0 hold" however the rows actually differed. Audit F17.
    //
    // The grant leg is shared by definition, so the EXERCISE leg is the only
    // thing that can differ per row: t1 was exercised in 2023 and is clear, t2
    // was exercised in February of the as-of year and cannot be.
    const p = basePlan({
      accountId: "acct-split",
      grants: [{
        id: "g-split", grantNumber: "ISO-SPLIT", grantType: "iso", grantDate: "2022-03-01",
        sharesGranted: 2000, has83bElection: false, fmvAtGrant: null,
        strikePrice: 12, strikeDiscountPct: null, expirationYear: 2032,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "t1", vestDate: "2023-03-01", shares: 1000, sharesExercised: 1000, sharesSold: 0,
            acquiredOn: "2023-04-01", priceAtAcquisition: 30, strategy: null },
          { id: "t2", vestDate: "2024-03-01", shares: 1000, sharesExercised: 1000, sharesSold: 0,
            acquiredOn: "2026-02-10", priceAtAcquisition: 60, strategy: null },
        ],
        plannedEvents: [],
      }],
    });
    const model = buildVestingSchedule([p], { asOfYear: 2026, planStartYear: 2026 });
    expect(model.rows[0].isoSplit).toEqual({ qualified: 1000, holding: 1000 });
  });

  it("puts a row with no stored acquisition date in HOLDING, never qualified", () => {
    const p = basePlan({
      accountId: "acct-nodate",
      grants: [{
        id: "g-nodate", grantNumber: "ISO-OLD", grantType: "iso", grantDate: "2018-03-01",
        sharesGranted: 1000, has83bElection: false, fmvAtGrant: null,
        strikePrice: 12, strikeDiscountPct: null, expirationYear: 2028,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "t1", vestDate: "2019-03-01", shares: 1000, sharesExercised: 1000, sharesSold: 0,
            acquiredOn: null, priceAtAcquisition: null, strategy: null },
        ],
        plannedEvents: [],
      }],
    });
    // The grant is eight years old, so the grant leg is clear by miles. Without
    // an exercise date the exercise leg cannot be shown to be clear at all, so
    // the badge must not promise long-term rates the ledger will not give.
    expect(buildVestingSchedule([p], { asOfYear: 2026, planStartYear: 2026 }).rows[0].isoSplit)
      .toEqual({ qualified: 0, holding: 1000 });
  });

  it("turns qualified exactly where isQualifyingIsoDisposition does, to the day", () => {
    // The badge asks the shared rule whether a sale on 31 December of the
    // as-of year would qualify — the same day the ledger dates a modeled sale,
    // which is what makes the two surfaces agree. So the two-year leg lands on
    // a single day: granted 2024-12-30 clears, granted 2024-12-31 does not
    // (the test is "more than two years", not "two years or more").
    const at = (grantDate: string, asOfYear: number) => {
      const p = isoPlan();
      p.grants = [p.grants[0]];
      p.grants[0].grantDate = grantDate;
      p.grants[0].tranches[0].acquiredOn = "2025-01-05"; // exercise leg clear either way
      return buildVestingSchedule([p], { asOfYear, planStartYear: 2026 }).rows[0].isoSplit;
    };
    expect(at("2024-12-30", 2026)).toEqual({ qualified: 3000, holding: 0 });
    expect(at("2024-12-31", 2026)).toEqual({ qualified: 0, holding: 3000 });
    // …and the same rule, called directly, agrees. If isoSplitFor ever stops
    // routing through the shared helper this pair stops matching.
    expect(isQualifyingIsoDisposition({
      grantDate: "2024-12-30", exerciseDate: "2025-01-05", dispositionDate: "2026-12-31",
    })).toBe(true);
    expect(isQualifyingIsoDisposition({
      grantDate: "2024-12-31", exerciseDate: "2025-01-05", dispositionDate: "2026-12-31",
    })).toBe(false);
  });

  it("the badge matches the branch the tax ledger takes on the same grant", () => {
    // The cross-surface check audit F17/F47 asked for: an ISO priced by
    // discount has a real bargain element, so the ledger's two branches are
    // distinguishable in dollars — qualified books capital gain, disqualifying
    // books ordinary income. The stored $60 price at exercise is what makes the
    // bargain element non-zero; with no stored price the strike resolves to 0
    // and BOTH branches book zero ordinary income, which would prove nothing.
    const mk = (grantDate: string): StockOptionPlan => ({
      ...basePlan({ accountId: "acct-x" }),
      pricePerShare: 100,
      growthRate: 0,
      grants: [{
        id: "g", grantNumber: "ISO", grantType: "iso", grantDate, sharesGranted: 1000,
        has83bElection: false, fmvAtGrant: null, strikePrice: null, strikeDiscountPct: 0.15,
        expirationYear: 2036, strategy: { sellTiming: "hold_then_sell_year", sellYear: 2026 },
        tranches: [{ id: "t", vestDate: grantDate, shares: 1000, sharesExercised: 1000, sharesSold: 0,
          acquiredOn: "2024-03-01", priceAtAcquisition: 60, strategy: null }],
        plannedEvents: [],
      }],
    });
    // Exercised 2024-03-01 either way, so the exercise leg is clear and the
    // grant leg decides: a 2023 grant clears two years before the 2026-12-31
    // sale, a 2025 grant does not.
    for (const [grantDate, expectQualified] of [["2023-06-01", true], ["2025-06-01", false]] as const) {
      const p = mk(grantDate);
      const badge = buildVestingSchedule([p], { asOfYear: 2026, planStartYear: 2026 }).rows[0].isoSplit;
      const r = computeEquityYear(p, createEquityState([p], 2026), 2026);
      expect(r.sellProceeds).toBeGreaterThan(0); // the sale really happened
      expect((badge?.qualified ?? 0) > 0).toBe(expectQualified);
      // Badge says qualified ⟺ ledger books no ordinary income on the sale.
      expect(r.ordinaryIncome === 0).toBe(expectQualified);
      // …and the disqualifying branch books a REAL number, so the ⟺ above is
      // not two zeroes agreeing by accident. Strike = $60 × 0.85 = $51.
      if (!expectQualified) expect(r.ordinaryIncome).toBeCloseTo(9000, 2); // (60 − 51) × 1,000
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

// ── Audit F1/F2 ──────────────────────────────────────────────────────────────
// The acquisition facts are optional, and `timeline.ts` falls back to the plan
// start date at a price of nothing when they are missing. The fallback is the
// right answer; SILENCE about it is not, because a conservative guess printed
// with no marker reads exactly like a recorded fact.
describe("buildVestingSchedule — the estimated-acquisition marker", () => {
  /** One ISO grant, exercised before the plan, with whatever facts are given. */
  function exercisedIso(t: { acquiredOn?: string | null; priceAtAcquisition?: number | null }): StockOptionPlan {
    return basePlan({
      accountId: "acct-est",
      grants: [{
        id: "g-est", grantNumber: "EST-1", grantType: "iso", grantDate: "2022-03-01",
        sharesGranted: 1000, has83bElection: false, fmvAtGrant: null,
        strikePrice: 12, strikeDiscountPct: null, expirationYear: 2032,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [{
          id: "e1", vestDate: "2023-03-01", shares: 1000, sharesExercised: 1000, sharesSold: 0,
          acquiredOn: t.acquiredOn ?? null, priceAtAcquisition: t.priceAtAcquisition ?? null,
          strategy: null,
        }],
        plannedEvents: [],
      }],
    });
  }
  /** An RSU grant whose every row vests in 2027-2028 — all AFTER the 2026 plan
   *  start, so nothing on it is seeded and nothing is guessed. */
  function futureRsu(): StockOptionPlan {
    return basePlan({
      accountId: "acct-est-rsu",
      grants: [{
        id: "g-est-rsu", grantNumber: "EST-RSU", grantType: "rsu", grantDate: "2026-01-15",
        sharesGranted: 2000, has83bElection: false, fmvAtGrant: null,
        strikePrice: null, strikeDiscountPct: null, expirationYear: null,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "r1", vestDate: "2027-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
          { id: "r2", vestDate: "2028-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        ],
        plannedEvents: [],
      }],
    });
  }
  const flag = (plan: StockOptionPlan) =>
    buildVestingSchedule([plan], { asOfYear: 2026, planStartYear: 2026 }).rows[0].hasEstimatedAcquisition;

  it("is false when both facts are recorded", () => {
    expect(flag(exercisedIso({ acquiredOn: "2023-04-01", priceAtAcquisition: 30 }))).toBe(false);
  });

  it("is true when the date is missing", () => {
    expect(flag(exercisedIso({ priceAtAcquisition: 30 }))).toBe(true);
  });

  it("is true when the date is there but the price is not", () => {
    // The price is not decoration: basis derives from it, and with no anchor
    // the engine floors basis at the strike — the largest taxable gain.
    expect(flag(exercisedIso({ acquiredOn: "2023-04-01" }))).toBe(true);
  });

  it("is false for an option row that has exercised nothing", () => {
    expect(flag(nqsoPlan())).toBe(false);
  });

  it("is false for an option row whose exercised shares were all sold", () => {
    // Nothing is seeded, so nothing is guessed — the disposal already happened.
    const p = exercisedIso({});
    p.grants[0].tranches[0].sharesSold = 1000;
    expect(flag(p)).toBe(false);
  });

  it("is false for RSU shares that have not vested yet", () => {
    // The plan's own text marks any RSU row carrying shares, which would flag
    // nearly every RSU grant in the book. A row vesting in 2027 acquires its
    // shares on its vest date — `acquire_rsu`, not `seed_held` — so no figure
    // on it comes from the fallback and there is nothing to warn about.
    expect(flag(futureRsu())).toBe(false);
  });

  it("is true for RSU shares vested before the plan with no acquisition entered", () => {
    // The same rows, read from a later plan start: they are now pre-plan, are
    // seeded from stored facts, and have none. This is the control that proves
    // the test above is measuring the vest date and not a dead flag.
    const row = buildVestingSchedule([futureRsu()], { asOfYear: 2030, planStartYear: 2030 }).rows[0];
    expect(row.hasEstimatedAcquisition).toBe(true);
  });

  /** An 83(b) grant DATED before the plan whose rows all vest after it. The
   *  per-row rule reads every row as future and finds nothing; the engine seeds
   *  the whole grant off `tranches[0]` because the election acquired it all at
   *  the grant date. Only the 83(b) branch can tell these apart. */
  function preplan83b(): StockOptionPlan {
    return basePlan({
      accountId: "acct-83b-est",
      grants: [{
        id: "g-83b-est", grantNumber: "83B-1", grantType: "rsu", grantDate: "2025-01-15",
        sharesGranted: 2000, has83bElection: true, fmvAtGrant: 10,
        strikePrice: null, strikeDiscountPct: null, expirationYear: null,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "b1", vestDate: "2026-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
          { id: "b2", vestDate: "2027-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
        ],
        plannedEvents: [],
      }],
    });
  }

  it("is true for a pre-plan 83(b) grant with no acquisition entered", () => {
    expect(flag(preplan83b())).toBe(true);
  });

  it("clears once the 83(b) grant's first row carries both facts", () => {
    const plan = preplan83b();
    plan.grants[0].tranches[0].acquiredOn = "2025-01-15";
    plan.grants[0].tranches[0].priceAtAcquisition = 10;
    expect(flag(plan)).toBe(false);
  });

  it("is true for an 83(b) grant with no rows at all to hold the facts", () => {
    // Permitted by the validator and handled by the timeline with a synthetic
    // row, so it is seeded — and there is nowhere on screen to enter the date.
    const plan = preplan83b();
    plan.grants[0].tranches = [];
    expect(flag(plan)).toBe(true);
  });

  it("is false for an 83(b) grant made after the plan started", () => {
    // Acquired inside the projection, so the plan models it and guesses nothing.
    const plan = preplan83b();
    plan.grants[0].grantDate = "2026-06-01";
    expect(flag(plan)).toBe(false);
  });
});

describe("buildVestingSchedule — edge cases", () => {
  it("treats an 83(b) RSU as fully vested with no future columns", () => {
    const plan = basePlan({
      accountId: "acct-83b",
      grants: [{
        id: "g-83b", grantNumber: "ACME 83b", grantType: "rsu", grantDate: "2025-01-15",
        sharesGranted: 2000, has83bElection: true, fmvAtGrant: 10,
        strikePrice: null, strikeDiscountPct: null, expirationYear: null,
        strategy: { ...EMPTY_STRATEGY },
        tranches: [
          { id: "b1", vestDate: "2026-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
          { id: "b2", vestDate: "2027-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null },
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
