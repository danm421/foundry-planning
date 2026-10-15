// src/lib/fact-finder/placement/map/__tests__/vesting.test.ts
import { describe, expect, it } from "vitest";
import { parseVestingSchedule } from "../vesting";

const UNREAD =
  'Vesting schedule: list each vest date and shares ("3/1/2027: 250; 3/1/2028: 250") or say "25% a year over 4 years from 3/1/2026".';
const grant = { grantDate: "2026-03-01", sharesGranted: 1000 };
const yearly = [
  { vestDate: "2027-03-01", shares: 250 },
  { vestDate: "2028-03-01", shares: 250 },
  { vestDate: "2029-03-01", shares: 250 },
  { vestDate: "2030-03-01", shares: 250 },
];

describe("parseVestingSchedule — each vest date with its shares", () => {
  it("reads date: shares pairs", () => {
    expect(parseVestingSchedule("3/1/2027: 250; 3/1/2028: 250", { grantDate: null, sharesGranted: 500 })).toEqual({
      ok: true,
      tranches: [
        { vestDate: "2027-03-01", shares: 250 },
        { vestDate: "2028-03-01", shares: 250 },
      ],
    });
  });

  it("reads shares-on-date pairs, ISO or written dates, thousands separators, in date order", () => {
    expect(parseVestingSchedule("250 on 2028-03-01, 250 on 2027-03-01", { grantDate: null, sharesGranted: 500 })).toEqual({
      ok: true,
      tranches: [
        { vestDate: "2027-03-01", shares: 250 },
        { vestDate: "2028-03-01", shares: 250 },
      ],
    });
    expect(
      parseVestingSchedule("Vests 1,000 shares on March 1, 2027 and 1,500 shares on Mar 1, 2028.", { grantDate: null, sharesGranted: 2500 }),
    ).toEqual({
      ok: true,
      tranches: [
        { vestDate: "2027-03-01", shares: 1000 },
        { vestDate: "2028-03-01", shares: 1500 },
      ],
    });
  });

  it("needs the shares to add up to Shares granted", () => {
    expect(parseVestingSchedule("3/1/2027: 450; 3/1/2028: 450", grant)).toEqual({
      ok: false,
      reason: "Vesting shares add up to 900, not 1,000.",
    });
  });

  it("takes the pairs as written when Shares granted is blank", () => {
    expect(parseVestingSchedule("3/1/2027: 450", { grantDate: null, sharesGranted: null })).toEqual({
      ok: true,
      tranches: [{ vestDate: "2027-03-01", shares: 450 }],
    });
  });

  it("refuses pairs mixed with words it can't read, or a date that doesn't exist", () => {
    expect(parseVestingSchedule("3/1/2027: 250 then the rest at IPO", grant)).toEqual({ ok: false, reason: UNREAD });
    expect(parseVestingSchedule("2/30/2027: 1000", grant)).toEqual({ ok: false, reason: UNREAD });
  });
});

describe("parseVestingSchedule — even vesting", () => {
  it("spreads the shares a period at a time from the grant date", () => {
    expect(parseVestingSchedule("25% a year over 4 years", grant)).toEqual({ ok: true, tranches: yearly });
    expect(parseVestingSchedule("Vests evenly over 4 years", grant)).toEqual({ ok: true, tranches: yearly });
    expect(parseVestingSchedule("25% annually", grant)).toEqual({ ok: true, tranches: yearly });
  });

  it("starts from a date it's given", () => {
    const result = parseVestingSchedule("quarterly over 3 years starting 3/1/2026", { grantDate: "2025-11-15", sharesGranted: 1200 });
    expect(result.ok && result.tranches.length).toBe(12);
    expect(result.ok && result.tranches[0]).toEqual({ vestDate: "2026-06-01", shares: 100 });
    expect(result.ok && result.tranches[11]).toEqual({ vestDate: "2029-03-01", shares: 100 });
    expect(parseVestingSchedule("25% a year over 4 years from 3/1/2026", { grantDate: null, sharesGranted: 1000 })).toEqual({
      ok: true,
      tranches: yearly,
    });
  });

  it("splits to six decimals, the last vest taking the remainder", () => {
    const result = parseVestingSchedule("evenly over 3 years", grant);
    expect(result).toEqual({
      ok: true,
      tranches: [
        { vestDate: "2027-03-01", shares: 333.333333 },
        { vestDate: "2028-03-01", shares: 333.333333 },
        { vestDate: "2029-03-01", shares: 333.333334 },
      ],
    });
    const total = result.ok ? result.tranches.reduce((sum, t) => sum + t.shares, 0) : 0;
    expect(Math.abs(total - 1000)).toBeLessThanOrEqual(1e-6);
  });

  it("keeps a month-end vest date inside its month", () => {
    const result = parseVestingSchedule("monthly over 1 year", { grantDate: "2026-01-31", sharesGranted: 1200 });
    expect(result.ok && result.tranches.slice(0, 3).map((t) => t.vestDate)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("needs Shares granted and a start", () => {
    expect(parseVestingSchedule("25% a year over 4 years", { grantDate: "2026-03-01", sharesGranted: null })).toEqual({
      ok: false,
      reason: "Add Shares granted to spread the vesting.",
    });
    expect(parseVestingSchedule("25% a year over 4 years", { grantDate: null, sharesGranted: 1000 })).toEqual({
      ok: false,
      reason: 'Add the Grant date, or say when vesting starts ("over 4 years from 3/1/2026").',
    });
  });

  it("refuses a percent that doesn't fit the period count", () => {
    expect(parseVestingSchedule("20% a year over 4 years", grant)).toEqual({ ok: false, reason: UNREAD });
    expect(parseVestingSchedule("30% a year", grant)).toEqual({ ok: false, reason: UNREAD });
  });
});

describe("parseVestingSchedule — anything else", () => {
  it("is refused with how to write it, never guessed", () => {
    for (const text of ["1-year cliff, then monthly", "graded", "evenly", "per the plan document", "monthly over 9999 years"]) {
      expect(parseVestingSchedule(text, grant)).toEqual({ ok: false, reason: UNREAD });
    }
  });
});

describe("parseVestingSchedule — long runs of spaces", () => {
  /** The result, and how long it took. */
  const timed = (text: string) => {
    const started = performance.now();
    const result = parseVestingSchedule(text, grant);
    return { result, ms: performance.now() - started };
  };
  const gap = " ".repeat(5000);

  it("5,000 spaces between words still parse, in well under a second", () => {
    const { result, ms } = timed(`25%${gap}a year${gap}over 4 years${gap}from${gap}3/1/2026`);
    expect(result).toEqual({ ok: true, tranches: yearly });
    expect(ms).toBeLessThan(200);
  });

  it("5,000 spaces before words it can't read are refused, in well under a second (no runaway regex)", () => {
    const { result, ms } = timed(`vests${gap}x`);
    expect(result).toEqual({ ok: false, reason: UNREAD });
    expect(ms).toBeLessThan(200);
  });
});
