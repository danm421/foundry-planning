// G6 — server-side validation for the stock-options data-entry surfaces.
//
// The API is the last line of defence: the grant editor is one screen, but the
// routes accept anything the schema lets through, and the projection engine
// trusts what it reads. Each block below pins one audit finding.
import { describe, it, expect } from "vitest";
import { grantCreateSchema } from "../stock-options";

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
