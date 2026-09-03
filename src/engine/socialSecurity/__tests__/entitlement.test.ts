import { describe, it, expect } from "vitest";
import {
  ssEntitlementMonth,
  monthsPaidInYear,
  effectiveClaimAgeMonths,
} from "../entitlement";

const AT_62 = 62 * 12;
const AT_67 = 67 * 12;
const AT_70 = 70 * 12;

describe("ssEntitlementMonth — claims at or after FRA", () => {
  it("starts in the birthday month for an ordinary mid-month birthday", () => {
    // Attains 67 on 2027-03-14; the throughout-the-month rule does not apply
    // above 62, so March 2027 is payable.
    expect(ssEntitlementMonth("1960-03-15", AT_67)).toEqual({ year: 2027, month: 3 });
  });

  it("gives a December birthday exactly one month of benefit in the claim year", () => {
    expect(ssEntitlementMonth("1960-12-15", AT_67)).toEqual({ year: 2027, month: 12 });
  });

  it("shifts a born-on-the-1st worker back one month", () => {
    // Attains 67 on 2027-02-28 → February is the first entitlement month.
    expect(ssEntitlementMonth("1960-03-01", AT_67)).toEqual({ year: 2027, month: 2 });
  });

  it("rolls a January-1 birth into the prior calendar year", () => {
    expect(ssEntitlementMonth("1960-01-01", AT_67)).toEqual({ year: 2026, month: 12 });
  });

  it("does not shift a born-on-the-2nd worker", () => {
    expect(ssEntitlementMonth("1960-03-02", AT_67)).toEqual({ year: 2027, month: 3 });
  });

  it("handles a delayed claim at 70", () => {
    expect(ssEntitlementMonth("1960-08-20", AT_70)).toEqual({ year: 2030, month: 8 });
  });

  it("honors extra claim-age months that cross a year boundary", () => {
    // 67y 6m from a 1960-09-10 birth → attains 2028-03.
    expect(ssEntitlementMonth("1960-09-10", AT_67 + 6)).toEqual({ year: 2028, month: 3 });
  });
});

describe("ssEntitlementMonth — the age-62 'throughout the month' rule", () => {
  it("pushes a born-on-the-3rd worker to the month after their birthday", () => {
    // Attains 62 on 2022-03-02 → not 62 for all of March → April.
    expect(ssEntitlementMonth("1960-03-03", AT_62)).toEqual({ year: 2022, month: 4 });
  });

  it("pays a born-on-the-2nd worker from their birthday month", () => {
    // Attains 62 on 2022-03-01 → 62 throughout March.
    expect(ssEntitlementMonth("1960-03-02", AT_62)).toEqual({ year: 2022, month: 3 });
  });

  it("pays a born-on-the-1st worker from their birthday month", () => {
    // Attains 62 on 2022-02-28 → 62 throughout March (February is not full).
    expect(ssEntitlementMonth("1960-03-01", AT_62)).toEqual({ year: 2022, month: 3 });
  });

  it("does not apply the rule one month above 62", () => {
    // 62y1m from a 1960-03-15 birth lands on April 2022, which is also the
    // earliest month the throughout-the-month rule allows — same answer.
    expect(ssEntitlementMonth("1960-03-15", AT_62 + 1)).toEqual({ year: 2022, month: 4 });
  });

  it("floors a below-62 claim age at the earliest lawful month", () => {
    expect(ssEntitlementMonth("1960-03-15", 60 * 12)).toEqual({ year: 2022, month: 4 });
  });

  it("returns null for an unparseable date of birth", () => {
    expect(ssEntitlementMonth("", AT_67)).toBeNull();
    expect(ssEntitlementMonth("1960-13-01", AT_67)).toBeNull();
  });
});

describe("monthsPaidInYear", () => {
  const dec = { year: 2027, month: 12 };
  const jun = { year: 2027, month: 6 };
  const jan = { year: 2027, month: 1 };

  it("pays nothing before the entitlement year", () => {
    expect(monthsPaidInYear(dec, 2026)).toBe(0);
  });
  it("pays one month for a December start", () => {
    expect(monthsPaidInYear(dec, 2027)).toBe(1);
  });
  it("pays seven months for a June start", () => {
    expect(monthsPaidInYear(jun, 2027)).toBe(7);
  });
  it("pays a full year for a January start", () => {
    expect(monthsPaidInYear(jan, 2027)).toBe(12);
  });
  it("pays a full year in every later year", () => {
    expect(monthsPaidInYear(dec, 2028)).toBe(12);
    expect(monthsPaidInYear(jun, 2035)).toBe(12);
  });
  it("pays nothing when entitlement is unresolvable", () => {
    expect(monthsPaidInYear(null, 2030)).toBe(0);
  });
});

describe("effectiveClaimAgeMonths", () => {
  it("is unchanged for a claim at FRA", () => {
    expect(effectiveClaimAgeMonths("1960-03-15", AT_67)).toBe(AT_67);
  });

  it("is unchanged for a born-on-the-1st worker (the shift cancels against FRA)", () => {
    expect(effectiveClaimAgeMonths("1960-03-01", AT_67)).toBe(AT_67);
  });

  it("credits the extra month a mid-month birthday cannot claim at 62", () => {
    // Earliest entitlement is April 2022, FRA month is March 2027 → 59 months
    // early, not the 60 a year-only model assumes.
    expect(effectiveClaimAgeMonths("1960-03-15", AT_62)).toBe(AT_62 + 1);
  });

  it("leaves a born-on-the-2nd worker at the full 60-month reduction", () => {
    expect(effectiveClaimAgeMonths("1960-03-02", AT_62)).toBe(AT_62);
  });

  it("is unchanged for a delayed claim", () => {
    expect(effectiveClaimAgeMonths("1960-08-20", AT_70)).toBe(AT_70);
  });

  it("falls back to the requested claim age when the DOB is unparseable", () => {
    expect(effectiveClaimAgeMonths("", AT_67)).toBe(AT_67);
  });
});
