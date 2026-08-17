// G6 — server-side validation for the stock-options data-entry surfaces.
//
// The API is the last line of defence: the grant editor is one screen, but the
// routes accept anything the schema lets through, and the projection engine
// trusts what it reads. Each block below pins one audit finding.
import { describe, it, expect } from "vitest";
import {
  grantCreateSchema,
  grantUpdateSchema,
  stockOptionAccountCreateSchema,
  stockOptionAccountUpdateSchema,
} from "../stock-options";

/** A minimal valid RSU grant whose one row sums to the shares granted. */
function rsuGrant(over: Record<string, unknown> = {}) {
  return {
    grantType: "rsu",
    grantDate: "2025-01-01",
    sharesGranted: 1000,
    tranches: [{ vestDate: "2028-01-01", shares: 1000, sharesExercised: 0, sharesSold: 0 }],
    ...over,
  };
}

/** A minimal valid NQSO grant. */
function nqsoGrant(over: Record<string, unknown> = {}) {
  return {
    grantType: "nqso",
    grantDate: "2025-01-01",
    sharesGranted: 1000,
    strikePrice: 10,
    expirationDate: "2035-01-01",
    tranches: [{ vestDate: "2028-01-01", shares: 1000, sharesExercised: 0, sharesSold: 0 }],
    ...over,
  };
}

/** Every issue message, so a test can name the rule it expects to fire. */
function messages(input: unknown): string[] {
  const r = grantCreateSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("grant PUT — an absent plannedEvents key leaves them alone (F18/F33)", () => {
  it("parses to undefined when the key is omitted, not to an empty list", () => {
    // The distinction the route depends on. `.optional().default([])` would
    // hand the route `[]`, and it would delete every stored event.
    const r = grantUpdateSchema.safeParse(rsuGrant());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.plannedEvents).toBeUndefined();
  });

  it("still carries an explicit list through", () => {
    const r = grantUpdateSchema.safeParse(
      rsuGrant({ plannedEvents: [{ year: 2030, action: "sell", shares: 500 }] }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.plannedEvents).toEqual([{ year: 2030, action: "sell", shares: 500 }]);
  });

  it("still carries an explicit empty list, which means 'clear them'", () => {
    const r = grantUpdateSchema.safeParse(rsuGrant({ plannedEvents: [] }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.plannedEvents).toEqual([]);
  });

  it("keeps defaulting to [] on CREATE, where there is nothing to preserve", () => {
    const r = grantCreateSchema.safeParse(rsuGrant());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.plannedEvents).toEqual([]);
  });

  it("applies every other grant rule to the update schema too", () => {
    const r = grantUpdateSchema.safeParse(rsuGrant({ sharesGranted: 10000 }));
    expect(r.success).toBe(false);
  });
});

describe("strategy companions must arrive with their timing (F29/F40)", () => {
  const SELL_YEAR = "A sell year is required when sell timing is hold-then-sell.";
  const SELL_PCT = "A sell percentage above zero is required when sell timing is percent-per-year.";
  const EX_YEAR = "An exercise year is required when exercise timing is a specific year.";

  /** Every issue message from an account create body. */
  function acctMessages(over: Record<string, unknown>): string[] {
    const r = stockOptionAccountCreateSchema.safeParse({
      name: "Acme Stock Options",
      owner: "client",
      ...over,
    });
    return r.success ? [] : r.error.issues.map((i) => i.message);
  }

  it("rejects an account default of hold-then-sell with no year", () => {
    // Measured on the real engine: this liquidates the entire position in the
    // VEST year — `sellYear ?? acquisitionYear` in timeline.ts — which is the
    // opposite of what "hold, then sell in 2032" asks for.
    expect(acctMessages({ defaultSellTiming: "hold_then_sell_year" })).toContain(SELL_YEAR);
  });

  it("rejects an account default of percent-per-year with no percentage", () => {
    // Measured on the real engine: `pct <= 0` returns no sell actions at all,
    // so "sell 25% per year" with a blank percent never sells a share.
    expect(acctMessages({ defaultSellTiming: "percent_per_year" })).toContain(SELL_PCT);
  });

  it("rejects a zero percentage, which is the same silence", () => {
    expect(
      acctMessages({ defaultSellTiming: "percent_per_year", defaultSellPercentPerYear: 0 }),
    ).toContain(SELL_PCT);
  });

  it("rejects a specific exercise year with no year", () => {
    expect(acctMessages({ defaultExerciseTiming: "specific_year" })).toContain(EX_YEAR);
  });

  it("accepts each timing once its companion is filled in", () => {
    expect(acctMessages({ defaultSellTiming: "hold_then_sell_year", defaultSellYear: 2032 })).toEqual([]);
    expect(
      acctMessages({ defaultSellTiming: "percent_per_year", defaultSellPercentPerYear: 0.25 }),
    ).toEqual([]);
    expect(
      acctMessages({ defaultExerciseTiming: "specific_year", defaultExerciseYear: 2030 }),
    ).toEqual([]);
  });

  it("leaves a start year optional — blank means 'as soon as I have them'", () => {
    expect(
      acctMessages({ defaultSellTiming: "percent_per_year", defaultSellPercentPerYear: 0.25 }),
    ).toEqual([]);
  });

  it("applies the same rule to a PATCH that names a timing", () => {
    const bad = stockOptionAccountUpdateSchema.safeParse({ defaultSellTiming: "hold_then_sell_year" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.message)).toContain(SELL_YEAR);
  });

  it("leaves a PATCH that does not name a timing alone", () => {
    // A rename must not have to resend the whole strategy block.
    expect(stockOptionAccountUpdateSchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("applies the rule at grant level", () => {
    expect(messages(rsuGrant({ sellTiming: "hold_then_sell_year" }))).toContain(SELL_YEAR);
    expect(messages(rsuGrant({ sellTiming: "percent_per_year" }))).toContain(SELL_PCT);
    expect(messages(nqsoGrant({ exerciseTiming: "specific_year" }))).toContain(EX_YEAR);
  });

  it("applies the rule to a per-tranche override, and names the row", () => {
    const r = grantCreateSchema.safeParse(rsuGrant({
      tranches: [
        { vestDate: "2028-01-01", shares: 1000, sharesExercised: 0, sharesSold: 0, sellTiming: "percent_per_year" },
      ],
    }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join("."))).toContain("tranches.0.sellPercentPerYear");
  });
});

describe("grant schema — the rows must add up to the grant (F39/F34)", () => {
  it("accepts rows that sum to sharesGranted", () => {
    expect(grantCreateSchema.safeParse(rsuGrant({
      sharesGranted: 10000,
      tranches: [
        { vestDate: "2028-01-01", shares: 4000, sharesExercised: 0, sharesSold: 0 },
        { vestDate: "2029-01-01", shares: 6000, sharesExercised: 0, sharesSold: 0 },
      ],
    })).success).toBe(true);
  });

  it("rejects rows that fall short of sharesGranted", () => {
    // The finding's case: 10,000 granted, one 4,000-share row. The plan vested
    // $200,000 of $500,000 while the report still said 10,000 unvested.
    expect(
      messages(rsuGrant({
        sharesGranted: 10000,
        tranches: [{ vestDate: "2028-01-01", shares: 4000, sharesExercised: 0, sharesSold: 0 }],
      })),
    ).toContain("Vesting tranches total 4000 of 10000 shares granted.");
  });

  it("rejects rows that overshoot sharesGranted", () => {
    expect(
      messages(rsuGrant({
        sharesGranted: 1000,
        tranches: [{ vestDate: "2028-01-01", shares: 4000, sharesExercised: 0, sharesSold: 0 }],
      })),
    ).toContain("Vesting tranches total 4000 of 1000 shares granted.");
  });

  it("rejects a grant with no vesting rows at all", () => {
    // Worth $0 in the plan while the report still shows every share.
    expect(messages(rsuGrant({ sharesGranted: 10000, tranches: [] }))).toContain(
      "At least one vesting tranche is required — the projection is built from the tranches.",
    );
  });

  it("still allows an 83(b) RSU with no rows, which the engine acquires whole", () => {
    expect(grantCreateSchema.safeParse(rsuGrant({
      has83bElection: true,
      fmvAtGrant: 12.5,
      sharesGranted: 10000,
      tranches: [],
    })).success).toBe(true);
  });

  it("but still makes an 83(b) grant's rows add up when it has them", () => {
    expect(
      messages(rsuGrant({
        has83bElection: true,
        fmvAtGrant: 12.5,
        sharesGranted: 10000,
        tranches: [{ vestDate: "2028-01-01", shares: 4000, sharesExercised: 0, sharesSold: 0 }],
      })),
    ).toContain("Vesting tranches total 4000 of 10000 shares granted.");
  });
});

describe("grant schema — shares must fit inside the bucket before them (F41)", () => {
  it("accepts a correctly nested option row", () => {
    expect(grantCreateSchema.safeParse(nqsoGrant({
      tranches: [{ vestDate: "2028-01-01", shares: 1000, sharesExercised: 400, sharesSold: 400 }],
    })).success).toBe(true);
  });

  it("rejects more exercised shares than the row holds", () => {
    // The finding's own case: 10,000 exercised on a 1,000-share row. The engine
    // seeded all 10,000 as held stock — $500,000 at $50 a share, from a typo.
    expect(
      messages(nqsoGrant({
        tranches: [{ vestDate: "2028-01-01", shares: 1000, sharesExercised: 10000, sharesSold: 0 }],
      })),
    ).toContain("sharesExercised cannot exceed the tranche's shares.");
  });

  it("rejects more sold shares than were exercised", () => {
    expect(
      messages(nqsoGrant({
        tranches: [{ vestDate: "2028-01-01", shares: 1000, sharesExercised: 100, sharesSold: 400 }],
      })),
    ).toContain("sharesSold cannot exceed sharesExercised.");
  });

  it("measures an RSU row against its shares, since RSUs never exercise", () => {
    // An RSU with sharesExercised 0 and 400 sold is ordinary, not an error.
    expect(grantCreateSchema.safeParse(rsuGrant({
      tranches: [{ vestDate: "2028-01-01", shares: 1000, sharesExercised: 0, sharesSold: 400 }],
    })).success).toBe(true);

    expect(
      messages(rsuGrant({
        tranches: [{ vestDate: "2028-01-01", shares: 1000, sharesExercised: 0, sharesSold: 1400 }],
      })),
    ).toContain("sharesSold cannot exceed the tranche's shares.");
  });

  it("names the offending row", () => {
    const r = grantCreateSchema.safeParse(nqsoGrant({
      sharesGranted: 2000,
      tranches: [
        { vestDate: "2028-01-01", shares: 1000, sharesExercised: 0, sharesSold: 0 },
        { vestDate: "2029-01-01", shares: 1000, sharesExercised: 9999, sharesSold: 0 },
      ],
    }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join("."))).toContain("tranches.1.sharesExercised");
  });
});

describe("tranche acquisition facts must be coherent (G8, audit F1/F2)", () => {
  const NEED_DATE = "An acquisition date is required when a price at acquisition is given.";
  const NO_SHARES = "This row has no acquired shares, so it has no acquisition to date.";
  const BEFORE_GRANT = "Shares cannot be acquired before the grant date.";

  it("accepts a date and a price, and carries BOTH VALUES through", () => {
    // `nqsoGrant`'s grant date is 2025-01-01, so the acquisition must be AFTER
    // it — the before-grant rule below is real and bites a careless fixture.
    const r = grantCreateSchema.safeParse(nqsoGrant({
      tranches: [{
        vestDate: "2025-01-15", shares: 1000, sharesExercised: 1000, sharesSold: 0,
        acquiredOn: "2025-11-04", priceAtAcquisition: 42.5,
      }],
    }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Assert the VALUES, never `success` alone. Zod strips unknown keys in
    // silence, so a schema that had never heard of these two fields would parse
    // this body happily and hand the route a pair of undefineds.
    expect(r.data.tranches[0].acquiredOn).toBe("2025-11-04");
    expect(r.data.tranches[0].priceAtAcquisition).toBe(42.5);
  });

  it("leaves both blank — the facts are optional and the engine falls back conservatively", () => {
    const r = grantCreateSchema.safeParse(nqsoGrant({
      tranches: [{ vestDate: "2024-01-15", shares: 1000, sharesExercised: 1000, sharesSold: 0 }],
    }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tranches[0].acquiredOn ?? null).toBeNull();
    expect(r.data.tranches[0].priceAtAcquisition ?? null).toBeNull();
  });

  it("rejects a price with no date — the price alone cannot be used", () => {
    // Without a date the holding period is unanswerable, so the price cannot be
    // applied to anything. Half a fact is worse than none.
    expect(messages(nqsoGrant({
      tranches: [{
        vestDate: "2024-01-15", shares: 1000, sharesExercised: 1000, sharesSold: 0,
        priceAtAcquisition: 42.5,
      }],
    }))).toContain(NEED_DATE);
  });

  it("rejects an acquisition date before the grant date", () => {
    expect(messages(nqsoGrant({
      grantDate: "2024-06-01",
      tranches: [{
        vestDate: "2025-01-15", shares: 1000, sharesExercised: 1000, sharesSold: 0,
        acquiredOn: "2024-01-04", priceAtAcquisition: 42.5,
      }],
    }))).toContain(BEFORE_GRANT);
  });

  it("rejects an acquisition date on a row with zero acquired shares", () => {
    // Nothing was acquired, so there is no acquisition to date. Accepting it
    // would leave a fact on screen the engine never reads.
    expect(messages(nqsoGrant({
      tranches: [{
        vestDate: "2025-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0,
        acquiredOn: "2025-11-04", priceAtAcquisition: 42.5,
      }],
    }))).toContain(NO_SHARES);
  });

  it("measures an RSU row against its shares, since RSUs never exercise", () => {
    // An RSU row's vested shares ARE its acquisition, so a date on a row with
    // shares is ordinary — the zero-shares rule must not fire on it.
    const r = grantCreateSchema.safeParse(rsuGrant({
      tranches: [{
        vestDate: "2025-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0,
        acquiredOn: "2025-01-15", priceAtAcquisition: 30,
      }],
    }));
    expect(r.success).toBe(true);
  });

  it("names the offending row", () => {
    const r = grantCreateSchema.safeParse(nqsoGrant({
      sharesGranted: 2000,
      tranches: [
        { vestDate: "2028-01-01", shares: 1000, sharesExercised: 0, sharesSold: 0 },
        {
          vestDate: "2029-01-01", shares: 1000, sharesExercised: 1000, sharesSold: 0,
          priceAtAcquisition: 42.5,
        },
      ],
    }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join("."))).toContain("tranches.1.acquiredOn");
  });
});
